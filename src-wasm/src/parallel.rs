/// Parallel processing module for multi-threaded CSV operations (rayon).
/// All outputs are ordered by row index so results are identical run to run.
use csv::StringRecord;
use ahash::{AHashMap, AHashSet};
use std::collections::hash_map::Entry;
use crate::types::{AddedRow, RemovedRow, ModifiedRow, UnchangedRow, Difference, DiffResult, DatasetMetadata};
use crate::utils::{KEY_SEP, record_to_hashmap, normalize_value_cow, get_row_key, get_row_fingerprint_fast, normalize_value_with_empty_vs_null};
use rayon::prelude::*;
use strsim::jaro_winkler;

/// Rows processed between two progress callbacks
const PROGRESS_CHUNK: usize = 1000;
/// Rows handled by one rayon task inside a progress chunk
const TASK_SIZE: usize = 64;
/// Per-thread progress messages are emitted at most this many times per phase
const THREAD_REPORTS: usize = 10;

/// Fuzzy matching: index entries shared by more rows than this are low signal and only
/// used when a source row has no other (more selective) value contributing candidates
const MAX_POSTING_LIST: usize = 1000;
/// Fuzzy matching: rank candidates by shared values and keep at least this many (plus all ties
/// with the last one kept)
const MAX_CANDIDATES: usize = 50;
/// Fuzzy matching: hard ceiling on candidates scored per source row
const CANDIDATE_CEILING: usize = 2000;
const SIMILARITY_THRESHOLD: f64 = 0.5;

/// Initialize the thread pool for parallel processing (native / tests).
/// On wasm32 the pool is created by wasm-bindgen-rayon's `init_thread_pool`
/// (re-exported from lib.rs), so this is a no-op there.
#[cfg(not(target_arch = "wasm32"))]
pub fn init_thread_pool(num_threads: usize) {
    rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build_global()
        .unwrap_or_else(|e| {
            // Log warning but don't panic - rayon may already be initialized
            eprintln!("Warning: Failed to initialize thread pool: {}", e);
        });
}

#[cfg(target_arch = "wasm32")]
pub fn init_thread_pool(_num_threads: usize) {}

/// Aggregates how many rows each rayon thread handled, per chunk rather than per row.
struct ThreadProgress {
    processed: Vec<usize>,
    per_thread_total: usize,
    chunks_done: usize,
    report_every: usize,
    total_chunks: usize,
}

impl ThreadProgress {
    fn new(total: usize) -> Self {
        let num_threads = rayon::current_num_threads().max(1);
        let per_thread_total = if total >= num_threads {
            total / num_threads + (total % num_threads != 0) as usize
        } else {
            1
        };
        let total_chunks = total.div_ceil(PROGRESS_CHUNK);
        ThreadProgress {
            processed: vec![0; num_threads],
            per_thread_total,
            chunks_done: 0,
            report_every: (total_chunks / THREAD_REPORTS).max(1),
            total_chunks,
        }
    }

    fn record(&mut self, thread_idx: usize, rows: usize) {
        let last = self.processed.len() - 1;
        self.processed[thread_idx.min(last)] += rows;
    }

    /// Called once per chunk. Returns true when per-thread messages should be emitted.
    fn chunk_done(&mut self) -> bool {
        self.chunks_done += 1;
        self.chunks_done % self.report_every == 0 || self.chunks_done == self.total_chunks
    }

    fn emit<F: FnMut(f64, &str)>(&self, progress: f64, on_progress: &mut F) {
        for (i, &processed_i) in self.processed.iter().enumerate() {
            // Only emit progress if this thread has actually processed work
            if processed_i == 0 {
                continue;
            }
            // Legacy format: THREAD_PROGRESS|<id>|<processed>|<perThreadTotal>
            on_progress(progress, &format!("THREAD_PROGRESS|{}|{}|{}", i, processed_i, self.per_thread_total));

            // JSON format: THREAD_PROGRESS_JSON|{"threadId":0,"processed":50,"perThreadTotal":125,"globalProgress":75.0}
            on_progress(progress, &format!(
                "THREAD_PROGRESS_JSON|{{\"threadId\":{},\"processed\":{},\"perThreadTotal\":{},\"globalProgress\":{}}}",
                i, processed_i, self.per_thread_total, progress
            ));
        }
    }
}

/// Map `f` over `0..total` in parallel, one progress chunk at a time. The output is in index order.
/// Fires a single global progress callback per chunk; per-thread messages are throttled.
fn run_chunked<R, F, P>(
    total: usize,
    label: &str,
    base_percent: f64,
    span_percent: f64,
    on_progress: &mut P,
    f: F,
) -> Vec<R>
where
    R: Send,
    F: Fn(usize) -> R + Sync,
    P: FnMut(f64, &str),
{
    let mut progress = ThreadProgress::new(total);
    let mut out = Vec::with_capacity(total);
    let mut done = 0;

    while done < total {
        let end = (done + PROGRESS_CHUNK).min(total);
        let starts: Vec<usize> = (done..end).step_by(TASK_SIZE).collect();
        let parts: Vec<(usize, Vec<R>)> = starts
            .par_iter()
            .map(|&start| {
                let thread_idx = rayon::current_thread_index().unwrap_or(0);
                let stop = (start + TASK_SIZE).min(end);
                (thread_idx, (start..stop).map(&f).collect())
            })
            .collect();

        for (thread_idx, rows) in parts {
            progress.record(thread_idx, rows.len());
            out.extend(rows);
        }
        done = end;

        let percent = base_percent + (done as f64 / total as f64) * span_percent;
        on_progress(percent, &format!("{} ({}/{})", label, done, total));
        if progress.chunk_done() {
            progress.emit(percent, on_progress);
        }
    }

    out
}

/// Key -> row index map. Fails on the first duplicate key.
fn build_key_map<'a>(keys: &'a [String], dataset: &str) -> Result<AHashMap<&'a str, usize>, String> {
    let mut map: AHashMap<&str, usize> = AHashMap::with_capacity(keys.len());
    for (i, key) in keys.iter().enumerate() {
        match map.entry(key.as_str()) {
            Entry::Occupied(_) => {
                return Err(format!("Duplicate Primary Key found in {}: \"{}\". Primary Keys must be unique.", dataset, key.replace(KEY_SEP, ", ")));
            }
            Entry::Vacant(v) => { v.insert(i); }
        }
    }
    Ok(map)
}

/// Non-excluded columns present in both datasets as (header, source index, target index), in source order.
fn comparable_columns<'a>(
    source_headers: &'a [String],
    source_header_map: &AHashMap<String, usize>,
    target_header_map: &AHashMap<String, usize>,
    excluded: &AHashSet<&str>,
) -> Vec<(&'a str, usize, usize)> {
    source_headers
        .iter()
        .filter(|h| !excluded.contains(h.as_str()))
        .filter_map(|h| {
            let s = *source_header_map.get(h)?;
            let t = *target_header_map.get(h)?;
            Some((h.as_str(), s, t))
        })
        .collect()
}

enum RowOutcome {
    Added(AddedRow),
    Modified(ModifiedRow),
    Unchanged(UnchangedRow),
}

/// Parallel implementation of CSV diff using primary keys
/// This is a parallel version of `core::diff_csv_primary_key_internal`
///
/// # Performance Trade-offs
/// Character-level diffs are intentionally skipped in parallel mode for performance.
/// The `diff` field in `Difference` will be empty.
#[allow(clippy::too_many_arguments)]
pub fn diff_csv_parallel_internal<F>(
    source_csv: &str,
    target_csv: &str,
    key_columns: Vec<String>,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns: Vec<String>,
    has_headers: bool,
    mut on_progress: F,
) -> Result<DiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    on_progress(0.0, "Parsing source CSV...");
    let (source_headers, source_rows, source_header_map) = crate::core::parse_csv_internal(source_csv, has_headers)?;

    on_progress(10.0, "Parsing target CSV...");
    let (target_headers, target_rows, target_header_map) = crate::core::parse_csv_internal(target_csv, has_headers)?;

    // Validation of key columns
    if key_columns.is_empty() {
        return Err("At least one primary key column is required.".into());
    }
    for key in &key_columns {
        if !source_header_map.contains_key(key) {
             return Err(format!("Primary key column \"{}\" not found in source dataset.", key).into());
        }
        if !target_header_map.contains_key(key) {
             return Err(format!("Primary key column \"{}\" not found in target dataset.", key).into());
        }
    }

    let excluded_set: AHashSet<&str> = excluded_columns.iter().map(|s| s.as_str()).collect();

    on_progress(20.0, "Building source map...");
    let source_keys: Vec<String> = source_rows
        .par_iter()
        .map(|row| get_row_key(row, &source_header_map, &key_columns))
        .collect();
    let source_map = build_key_map(&source_keys, "source")?;

    on_progress(40.0, "Building target map...");
    let target_keys: Vec<String> = target_rows
        .par_iter()
        .map(|row| get_row_key(row, &target_header_map, &key_columns))
        .collect();
    let target_map = build_key_map(&target_keys, "target")?;

    on_progress(60.0, "Comparing rows...");

    let columns = comparable_columns(&source_headers, &source_header_map, &target_header_map, &excluded_set);

    // Removed rows, in source row order
    let removed: Vec<RemovedRow> = (0..source_keys.len())
        .into_par_iter()
        .filter(|&i| !target_map.contains_key(source_keys[i].as_str()))
        .map(|i| RemovedRow {
            key: source_keys[i].clone(),
            source_row: record_to_hashmap(&source_rows[i], &source_headers),
        })
        .collect();

    // Added, modified and unchanged rows, in target row order
    let outcomes = run_chunked(
        target_keys.len(),
        "Comparing rows...",
        60.0,
        40.0,
        &mut on_progress,
        |target_row_idx| {
            let key = &target_keys[target_row_idx];
            let target_row = &target_rows[target_row_idx];

            let Some(&source_row_idx) = source_map.get(key.as_str()) else {
                return RowOutcome::Added(AddedRow {
                    key: key.clone(),
                    target_row: record_to_hashmap(target_row, &target_headers),
                });
            };

            let source_row = &source_rows[source_row_idx];
            let mut differences = Vec::new();

            for &(header, source_idx, target_idx) in &columns {
                let source_val_raw = source_row.get(source_idx).unwrap_or("");
                let target_val_raw = target_row.get(target_idx).unwrap_or("");

                let source_val = normalize_value_cow(source_val_raw, case_sensitive, ignore_whitespace, ignore_empty_vs_null);
                let target_val = normalize_value_cow(target_val_raw, case_sensitive, ignore_whitespace, ignore_empty_vs_null);

                if source_val != target_val {
                    differences.push(Difference {
                        column: header.to_string(),
                        old_value: source_val_raw.to_string(),
                        new_value: target_val_raw.to_string(),
                        diff: Vec::new(), // Skip char diffs in parallel mode for performance
                    });
                }
            }

            if differences.is_empty() {
                RowOutcome::Unchanged(UnchangedRow {
                    key: key.clone(),
                    row: record_to_hashmap(source_row, &source_headers),
                })
            } else {
                RowOutcome::Modified(ModifiedRow {
                    key: key.clone(),
                    source_row: record_to_hashmap(source_row, &source_headers),
                    target_row: record_to_hashmap(target_row, &target_headers),
                    differences,
                })
            }
        },
    );

    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();
    for outcome in outcomes {
        match outcome {
            RowOutcome::Added(a) => added.push(a),
            RowOutcome::Modified(m) => modified.push(m),
            RowOutcome::Unchanged(u) => unchanged.push(u),
        }
    }

    on_progress(100.0, "Complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
        // Consumers only read headers; avoid converting every row to a HashMap
        source: DatasetMetadata { headers: source_headers, rows: Vec::new() },
        target: DatasetMetadata { headers: target_headers, rows: Vec::new() },
        key_columns,
        excluded_columns,
        mode: "primary-key".to_string(),
    })
}

struct MatchCandidate {
    source_idx: usize,
    target_idx: usize,
    score: f64,
}

/// Parallel implementation of CSV diff using content matching (fuzzy matching)
pub fn diff_csv_content_match_parallel<F>(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns: Vec<String>,
    has_headers: bool,
    mut on_progress: F,
) -> Result<DiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    on_progress(0.0, "Parsing source CSV...");
    let (source_headers, source_rows, source_header_map) = crate::core::parse_csv_internal(source_csv, has_headers)?;

    on_progress(10.0, "Parsing target CSV...");
    let (target_headers_orig, target_rows_orig, target_header_map_orig) = crate::core::parse_csv_internal(target_csv, has_headers)?;

    let (target_headers, target_rows, target_header_map) = if source_headers != target_headers_orig && source_headers.len() == target_headers_orig.len() {
        (source_headers.clone(), target_rows_orig, source_header_map.clone())
    } else {
        (target_headers_orig, target_rows_orig, target_header_map_orig)
    };

    on_progress(20.0, "Building fingerprint index...");

    // Use HashSets for excluded columns for O(1) lookup
    let excluded_set: AHashSet<String> = excluded_columns.iter().cloned().collect();
    let excluded_str: AHashSet<&str> = excluded_columns.iter().map(|s| s.as_str()).collect();
    let source_col_included: Vec<bool> = source_headers.iter().map(|h| !excluded_set.contains(h)).collect();
    let target_col_included: Vec<bool> = target_headers.iter().map(|h| !excluded_set.contains(h)).collect();
    // Source column index -> target column index with the same header
    let source_to_target_col: Vec<Option<usize>> = source_headers.iter().map(|h| target_header_map.get(h).copied()).collect();

    // Same normalization for indexing and probing the fuzzy candidate lookup
    let index_value = |cell: &str| -> String {
        let trimmed = cell.trim();
        match (case_sensitive, ignore_whitespace) {
            (true, true) => trimmed.to_string(),
            (true, false) => cell.to_string(),
            (false, true) => trimmed.to_lowercase(),
            (false, false) => cell.to_lowercase(),
        }
    };

    let fingerprint = |row: &StringRecord, headers: &[String], header_map: &AHashMap<String, usize>| {
        get_row_fingerprint_fast(row, headers, header_map, case_sensitive, ignore_whitespace, ignore_empty_vs_null, &excluded_set)
    };

    let target_fingerprints: Vec<String> = target_rows
        .par_iter()
        .map(|row| fingerprint(row, &source_headers, &target_header_map))
        .collect();
    let source_fingerprints: Vec<String> = source_rows
        .par_iter()
        .map(|row| fingerprint(row, &source_headers, &source_header_map))
        .collect();

    // Fingerprint -> target rows. Inserted in reverse so `pop` yields the lowest index first.
    let mut target_fingerprint_lookup: AHashMap<String, Vec<usize>> = AHashMap::new();
    for (idx, fp) in target_fingerprints.into_iter().enumerate().rev() {
        target_fingerprint_lookup.entry(fp).or_default().push(idx);
    }

    on_progress(30.0, "Matching exact rows...");

    // Exact matching (sequential; consumes each target row at most once)
    let mut target_free = vec![true; target_rows.len()];
    let mut unchanged_source_indices: Vec<usize> = Vec::new();
    let mut unmatched_source_indices: Vec<usize> = Vec::new();
    for (i, fp) in source_fingerprints.iter().enumerate() {
        match target_fingerprint_lookup.get_mut(fp).and_then(|indices| indices.pop()) {
            Some(target_idx) => {
                target_free[target_idx] = false;
                unchanged_source_indices.push(i);
            }
            None => unmatched_source_indices.push(i),
        }
    }

    // Value index over the still-unmatched target rows (posting lists are in ascending row order)
    let mut target_value_lookup: AHashMap<(usize, String), Vec<usize>> = AHashMap::new();
    for (row_idx, row) in target_rows.iter().enumerate() {
        if !target_free[row_idx] {
            continue;
        }
        for (col_idx, cell) in row.iter().enumerate() {
            if !target_col_included.get(col_idx).copied().unwrap_or(false) || cell.trim().is_empty() {
                continue;
            }
            target_value_lookup.entry((col_idx, index_value(cell))).or_default().push(row_idx);
        }
    }

    on_progress(50.0, "Fuzzy matching in parallel...");

    // Columns used for scoring: unique headers present in both datasets, in source order
    let mut seen_headers: AHashSet<&str> = AHashSet::new();
    let score_columns: Vec<(usize, usize)> = comparable_columns(&source_headers, &source_header_map, &target_header_map, &excluded_str)
        .into_iter()
        .filter(|&(header, _, _)| seen_headers.insert(header))
        .map(|(_, s, t)| (s, t))
        .collect();

    // Best match per unmatched source row, computed in parallel against the read-only index
    let candidates_per_row = run_chunked(
        unmatched_source_indices.len(),
        "Fuzzy matching in parallel...",
        50.0,
        40.0,
        &mut on_progress,
        |pos| {
            let source_idx = unmatched_source_indices[pos];
            let source_row = &source_rows[source_idx];

            // Posting lists for the row's values; very common values are kept apart
            let mut selective: Vec<&Vec<usize>> = Vec::new();
            let mut common: Vec<&Vec<usize>> = Vec::new();
            for (col_idx, cell) in source_row.iter().enumerate() {
                if !source_col_included.get(col_idx).copied().unwrap_or(false) || cell.trim().is_empty() {
                    continue;
                }
                let Some(target_col_idx) = source_to_target_col.get(col_idx).copied().flatten() else {
                    continue;
                };
                if let Some(indices) = target_value_lookup.get(&(target_col_idx, index_value(cell))) {
                    if indices.len() > MAX_POSTING_LIST {
                        common.push(indices);
                    } else {
                        selective.push(indices);
                    }
                }
            }
            // Common values only count when nothing more selective is shared
            let lists = if selective.is_empty() { common } else { selective };

            // Count shared values per candidate target row
            let mut shared_values: AHashMap<usize, u32> = AHashMap::new();
            for indices in lists {
                for &idx in indices {
                    *shared_values.entry(idx).or_insert(0) += 1;
                }
            }

            // Rank by shared values (lowest index on ties). Keep everything that ties with the
            // last of the top MAX_CANDIDATES, up to the ceiling, so ties are never cut by index.
            let mut candidates: Vec<(usize, u32)> = shared_values.into_iter().collect();
            candidates.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            if candidates.len() > MAX_CANDIDATES {
                let cutoff = candidates[MAX_CANDIDATES - 1].1;
                let keep = candidates.iter().take_while(|c| c.1 >= cutoff).count();
                candidates.truncate(keep.min(CANDIDATE_CEILING));
            }
            if candidates.is_empty() {
                return None;
            }

            let source_norm: Vec<String> = score_columns
                .iter()
                .map(|&(s, _)| normalize_value_with_empty_vs_null(source_row.get(s).unwrap_or(""), case_sensitive, ignore_whitespace, ignore_empty_vs_null))
                .collect();

            let mut best: Option<(usize, f64)> = None;
            for (target_idx, _) in candidates {
                let target_row = &target_rows[target_idx];

                let mut total_score = 0.0;
                for (&(_, t), s_norm) in score_columns.iter().zip(&source_norm) {
                    let t_norm = normalize_value_with_empty_vs_null(target_row.get(t).unwrap_or(""), case_sensitive, ignore_whitespace, ignore_empty_vs_null);
                    total_score += if *s_norm == t_norm { 1.0 } else { jaro_winkler(s_norm, &t_norm) };
                }
                let avg_score = if score_columns.is_empty() { 0.0 } else { total_score / score_columns.len() as f64 };

                if avg_score <= SIMILARITY_THRESHOLD {
                    continue;
                }
                // Ties go to the lowest target index
                let better = match best {
                    None => true,
                    Some((best_idx, best_score)) => avg_score > best_score || (avg_score == best_score && target_idx < best_idx),
                };
                if better {
                    best = Some((target_idx, avg_score));
                }
            }

            best.map(|(target_idx, score)| MatchCandidate { source_idx, target_idx, score })
        },
    );

    // Resolve conflicts: highest score wins, ties by lowest source then target index
    let mut sorted_matches: Vec<MatchCandidate> = candidates_per_row.into_iter().flatten().collect();
    sorted_matches.sort_by(|a, b| {
        b.score.total_cmp(&a.score)
            .then(a.source_idx.cmp(&b.source_idx))
            .then(a.target_idx.cmp(&b.target_idx))
    });

    on_progress(90.0, "Building results...");

    let mut source_matched = vec![false; source_rows.len()];
    let mut accepted: Vec<(usize, usize)> = Vec::new();
    for m in sorted_matches {
        if source_matched[m.source_idx] || !target_free[m.target_idx] {
            continue;
        }
        source_matched[m.source_idx] = true;
        target_free[m.target_idx] = false;
        accepted.push((m.source_idx, m.target_idx));
    }
    accepted.sort_unstable();

    let columns = comparable_columns(&source_headers, &source_header_map, &target_header_map, &excluded_str);

    let unchanged: Vec<UnchangedRow> = unchanged_source_indices
        .par_iter()
        .map(|&i| UnchangedRow {
            key: format!("Row {}", i + 1),
            row: record_to_hashmap(&source_rows[i], &source_headers),
        })
        .collect();

    let modified: Vec<ModifiedRow> = accepted
        .par_iter()
        .map(|&(source_idx, target_idx)| {
            let source_row = &source_rows[source_idx];
            let target_row = &target_rows[target_idx];

            let mut differences = Vec::new();
            for &(header, s, t) in &columns {
                let s_val = source_row.get(s).unwrap_or("");
                let t_val = target_row.get(t).unwrap_or("");

                let s_norm = normalize_value_cow(s_val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);
                let t_norm = normalize_value_cow(t_val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);

                if s_norm != t_norm {
                    differences.push(Difference {
                        column: header.to_string(),
                        old_value: s_val.to_string(),
                        new_value: t_val.to_string(),
                        diff: Vec::new(), // Skip char diffs in parallel
                    });
                }
            }

            ModifiedRow {
                key: format!("Row {}", source_idx + 1),
                source_row: record_to_hashmap(source_row, &source_headers),
                target_row: record_to_hashmap(target_row, &target_headers),
                differences,
            }
        })
        .collect();

    // Remaining unmatched source rows are Removed
    let removed: Vec<RemovedRow> = unmatched_source_indices
        .par_iter()
        .filter(|&&i| !source_matched[i])
        .map(|&i| RemovedRow {
            key: format!("Row {}", i + 1),
            source_row: record_to_hashmap(&source_rows[i], &source_headers),
        })
        .collect();

    // Remaining unmatched target rows are Added
    let added: Vec<AddedRow> = (0..target_rows.len())
        .into_par_iter()
        .filter(|&i| target_free[i])
        .map(|i| AddedRow {
            key: format!("Row {}", i + 1),
            target_row: record_to_hashmap(&target_rows[i], &target_headers),
        })
        .collect();

    on_progress(100.0, "Complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
        // For large datasets, avoid converting all rows to HashMap (huge perf win)
        source: DatasetMetadata { headers: source_headers, rows: Vec::new() },
        target: DatasetMetadata { headers: target_headers, rows: Vec::new() },
        key_columns: vec![],
        excluded_columns,
        mode: "content-match".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(src: &str, tgt: &str, keys: &[&str], case_sensitive: bool) -> Result<DiffResult, Box<dyn std::error::Error>> {
        diff_csv_parallel_internal(
            src,
            tgt,
            keys.iter().map(|s| s.to_string()).collect(),
            case_sensitive,
            false,
            false,
            vec![],
            true,
            |_, _| {},
        )
    }

    fn content(src: &str, tgt: &str, case_sensitive: bool) -> DiffResult {
        diff_csv_content_match_parallel(src, tgt, case_sensitive, true, false, vec![], true, |_, _| {}).unwrap()
    }

    /// Canonical form of a result for equality checks (HashMap rows rendered in sorted order)
    fn snapshot(r: &DiffResult) -> String {
        fn row(m: &std::collections::HashMap<String, String>) -> String {
            let mut v: Vec<_> = m.iter().collect();
            v.sort();
            format!("{:?}", v)
        }
        let mut out = format!("{}|{:?}|{:?}\n", r.mode, r.source.headers, r.target.headers);
        for a in &r.added { out += &format!("A {} {}\n", a.key, row(&a.target_row)); }
        for x in &r.removed { out += &format!("R {} {}\n", x.key, row(&x.source_row)); }
        for m in &r.modified {
            let d: Vec<_> = m.differences.iter().map(|d| format!("{}:{}>{}", d.column, d.old_value, d.new_value)).collect();
            out += &format!("M {} {} {} {:?}\n", m.key, row(&m.source_row), row(&m.target_row), d);
        }
        for u in &r.unchanged { out += &format!("U {} {}\n", u.key, row(&u.row)); }
        out
    }

    fn keys<T>(rows: &[T], f: impl Fn(&T) -> &str) -> Vec<String> {
        rows.iter().map(|r| f(r).to_string()).collect()
    }

    #[test]
    fn test_init_thread_pool() {
        // Test that thread pool initialization doesn't panic
        init_thread_pool(4);
        init_thread_pool(2); // Should handle re-initialization gracefully
    }

    #[test]
    fn duplicate_keys_error() {
        let err = pk("id,v\n1,a\n1,b\n", "id,v\n1,a\n", &["id"], true).err().unwrap();
        assert!(err.to_string().contains("Duplicate Primary Key found in source: \"1\""), "{}", err);
        let err = pk("id,v\n1,a\n", "id,v\n2,a\n2,b\n", &["id"], true).err().unwrap();
        assert!(err.to_string().contains("Duplicate Primary Key found in target: \"2\""), "{}", err);
    }

    #[test]
    fn empty_key_list_errors() {
        let err = pk("id,v\n1,a\n", "id,v\n1,a\n", &[], true).err().unwrap();
        assert!(err.to_string().contains("primary key column is required"));
    }

    #[test]
    fn pk_mode_string_and_empty_rows() {
        let r = pk("id,v\n1,a\n", "id,v\n1,a\n", &["id"], true).unwrap();
        assert_eq!(r.mode, "primary-key");
        assert!(r.source.rows.is_empty() && r.target.rows.is_empty());
        assert_eq!(content("a,b\n1,2\n", "a,b\n1,2\n", true).mode, "content-match");
    }

    fn mixed_dataset() -> (String, String) {
        let mut src = String::from("id,name,v\n");
        let mut tgt = String::from("id,name,v\n");
        for i in 0..300 {
            src.push_str(&format!("{},name{},a\n", i, i));
            if i % 10 != 0 {
                tgt.push_str(&format!("{},name{},{}\n", i, i, if i % 2 == 1 { "b" } else { "a" }));
            }
        }
        for i in 300..330 {
            tgt.push_str(&format!("{},new{},n\n", i, i));
        }
        (src, tgt)
    }

    #[test]
    fn parallel_pk_matches_sequential() {
        let (src, tgt) = mixed_dataset();
        let par = pk(&src, &tgt, &["id"], true).unwrap();
        let seq = crate::core::diff_csv_primary_key_internal(
            &src, &tgt, vec!["id".to_string()], true, false, false, vec![], true, |_, _| {},
        ).unwrap();

        assert_eq!(keys(&par.added, |r| &r.key), keys(&seq.added, |r| &r.key));
        assert_eq!(keys(&par.removed, |r| &r.key), keys(&seq.removed, |r| &r.key));
        assert_eq!(keys(&par.modified, |r| &r.key), keys(&seq.modified, |r| &r.key));
        assert_eq!(keys(&par.unchanged, |r| &r.key), keys(&seq.unchanged, |r| &r.key));
        assert_eq!(par.added.len(), 30);
        assert_eq!(par.removed.len(), 30);
        assert_eq!(par.modified.len(), 150);
        for (p, s) in par.modified.iter().zip(&seq.modified) {
            let cols = |m: &ModifiedRow| m.differences.iter().map(|d| (d.column.clone(), d.old_value.clone(), d.new_value.clone())).collect::<Vec<_>>();
            assert_eq!(cols(p), cols(s));
        }
        // Row-index ordering
        assert_eq!(&keys(&par.removed, |r| &r.key)[..3], ["0", "10", "20"]);
        assert_eq!(&keys(&par.modified, |r| &r.key)[..3], ["1", "3", "5"]);
        assert_eq!(keys(&par.added, |r| &r.key)[0], "300");
    }

    #[test]
    fn pk_output_is_deterministic() {
        let (src, tgt) = mixed_dataset();
        let a = snapshot(&pk(&src, &tgt, &["id"], true).unwrap());
        let b = snapshot(&pk(&src, &tgt, &["id"], true).unwrap());
        assert_eq!(a, b);
    }

    #[test]
    fn content_match_output_is_deterministic() {
        // ~2k rows with many near-duplicates so fuzzy ties are common
        let mut src = String::from("name,city,note\n");
        let mut tgt = String::from("name,city,note\n");
        for i in 0..2000 {
            src.push_str(&format!("person{},city{},note {}\n", i % 400, i % 7, i));
            if i % 5 != 0 {
                tgt.push_str(&format!("person{},city{},note {}x\n", i % 400, i % 7, i));
            }
        }
        let a = content(&src, &tgt, false);
        let b = content(&src, &tgt, false);
        assert_eq!(snapshot(&a), snapshot(&b));
        assert!(!a.modified.is_empty());
        // Outputs are in row order
        let nums = |rows: Vec<String>| rows.iter().map(|k| k.trim_start_matches("Row ").parse::<usize>().unwrap()).collect::<Vec<_>>();
        for v in [nums(keys(&a.removed, |r| &r.key)), nums(keys(&a.added, |r| &r.key)), nums(keys(&a.modified, |r| &r.key)), nums(keys(&a.unchanged, |r| &r.key))] {
            assert!(v.windows(2).all(|w| w[0] < w[1]));
        }
    }

    #[test]
    fn fuzzy_common_values_match_sequential() {
        // 2000 target rows all share "active,DE"; only row 1500 resembles the source row
        let src = "status,country,name\nactive,DE,Jon Smith\n";
        let mut tgt = String::from("status,country,name\n");
        for i in 0..2000 {
            if i == 1500 {
                tgt.push_str("active,DE,John Smith\n");
            } else {
                tgt.push_str(&format!("active,DE,Zq{:04}\n", i));
            }
        }
        let par = content(src, &tgt, true);
        let seq = crate::content_match::diff_csv_internal(src, &tgt, true, true, false, vec![], true, |_, _| {}).unwrap();

        assert_eq!(par.modified.len(), 1);
        assert_eq!(par.modified[0].key, "Row 1");
        assert_eq!(par.modified[0].target_row.get("name").map(String::as_str), Some("John Smith"));
        assert!(par.removed.is_empty());
        assert_eq!(par.added.len(), 1999);
        // The sequential path labels added rows differently, so compare the contents
        let added_rows = |r: &DiffResult| { let mut v: Vec<String> = r.added.iter().map(|a| a.target_row["name"].clone()).collect(); v.sort(); v };
        assert_eq!(added_rows(&par), added_rows(&seq));
        assert_eq!(keys(&par.removed, |r| &r.key), keys(&seq.removed, |r| &r.key));
        assert_eq!(keys(&par.modified, |r| &r.key), keys(&seq.modified, |r| &r.key));
        let pair = |m: &ModifiedRow| (m.source_row.clone(), m.target_row.clone());
        assert_eq!(pair(&par.modified[0]), pair(&seq.modified[0]));
    }

    #[test]
    fn fuzzy_probe_matches_mixed_case() {
        // Only shared value is "ALICE" vs "alice" (different case), so the normalized probe must find it
        let src = "name,city,note\nALICE,Berlin,hello world\n";
        let tgt = "name,city,note\nalice,Berlino,hello worlds\n";
        let r = content(src, tgt, false);
        assert_eq!(r.modified.len(), 1);
        assert!(r.added.is_empty() && r.removed.is_empty());

        // Case-sensitive: no shared exact value, so no candidates
        let r = content(src, tgt, true);
        assert_eq!(r.removed.len(), 1);
        assert_eq!(r.added.len(), 1);
    }

    #[test]
    fn fuzzy_tie_goes_to_lowest_target_index() {
        let src = "name,note\nbob,hello\n";
        // Two equally good candidates: lowest index must win every time
        let tgt = "name,note\nbob,hellp\nbob,hellp\n";
        for _ in 0..5 {
            let r = content(src, tgt, true);
            assert_eq!(r.modified.len(), 1);
            assert_eq!(keys(&r.added, |r| &r.key), ["Row 2"]);
        }
    }

    #[test]
    fn progress_fires_once_per_chunk_with_thread_messages() {
        let mut src = String::from("id,v\n");
        let mut tgt = String::from("id,v\n");
        for i in 0..3500 {
            src.push_str(&format!("{},a\n", i));
            tgt.push_str(&format!("{},b\n", i));
        }
        let mut messages: Vec<String> = Vec::new();
        diff_csv_parallel_internal(&src, &tgt, vec!["id".to_string()], true, false, false, vec![], true, |_, m| messages.push(m.to_string())).unwrap();

        let chunk_msgs = messages.iter().filter(|m| m.starts_with("Comparing rows... (")).count();
        assert_eq!(chunk_msgs, 4); // 3500 rows / 1000 per chunk
        assert!(messages.iter().any(|m| m.starts_with("THREAD_PROGRESS|")));
        assert!(messages.iter().any(|m| m.starts_with("THREAD_PROGRESS_JSON|")));
        // The report after the last chunk carries the final per-thread counts
        let last_chunk = messages.iter().position(|m| m == "Comparing rows... (3500/3500)").unwrap();
        let total: usize = messages[last_chunk..].iter()
            .filter(|m| m.starts_with("THREAD_PROGRESS|"))
            .map(|m| m.split('|').nth(2).unwrap().parse::<usize>().unwrap())
            .sum();
        assert_eq!(total, 3500);
    }
}
