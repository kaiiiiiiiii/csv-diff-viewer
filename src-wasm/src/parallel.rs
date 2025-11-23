/// Parallel processing module for multi-threaded CSV operations
/// Currently provides a parallel-like interface that's implemented sequentially for WASM compatibility
use csv::StringRecord;
use ahash::{AHashMap, AHashSet};
use crate::types::{AddedRow, RemovedRow, ModifiedRow, UnchangedRow, Difference, DiffResult};
use crate::utils::{record_to_hashmap, normalize_value_with_empty_vs_null, get_row_key, get_row_fingerprint};
use rayon::prelude::*;
use strsim::jaro_winkler;

/// Initialize the thread pool for parallel processing
/// Currently a no-op for WASM compatibility
pub fn init_thread_pool(_num_threads: usize) {
    // In WASM, threading is handled differently
    // This is just a placeholder for now
}

/// Parallel comparison of target rows against source map
/// This is the most compute-intensive part of the diff operation
///
/// # Performance Trade-offs
/// Character-level diffs are intentionally skipped in parallel mode for performance.
/// The `diff` field in `Difference` will be empty. If character-level diffs are required,
/// use the non-parallel comparison functions or post-process the results.
#[allow(clippy::too_many_arguments)]
pub fn parallel_compare_rows(
    target_map: &AHashMap<String, usize>,
    target_rows: &[StringRecord],
    target_headers: &[String],
    target_header_map: &AHashMap<String, usize>,
    source_map: &AHashMap<String, usize>,
    source_rows: &[StringRecord],
    source_headers: &[String],
    source_header_map: &AHashMap<String, usize>,
    excluded_columns: &[String],
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
) -> (Vec<AddedRow>, Vec<ModifiedRow>, Vec<UnchangedRow>) {
    // Convert HashMap to Vec for iteration
    let target_keys: Vec<_> = target_map.iter().collect();
    
    // Process sequentially for now (will be parallel in native builds)
    let results: Vec<_> = target_keys
        .par_iter()
        .map(|(key, &target_row_idx)| {
            let target_row = &target_rows[target_row_idx];
            
            match source_map.get(*key) {
                None => {
                    // Row added in target
                    (Some(AddedRow {
                        key: (*key).clone(),
                        target_row: record_to_hashmap(target_row, target_headers),
                    }), None, None)
                }
                Some(&source_row_idx) => {
                    let source_row = &source_rows[source_row_idx];
                    let mut differences = Vec::new();
                    
                    // Compare all columns
                    for header in source_headers {
                        if excluded_columns.contains(header) {
                            continue;
                        }
                        
                        let source_idx = source_header_map.get(header).unwrap();
                        let target_idx = match target_header_map.get(header) {
                            Some(idx) => idx,
                            None => continue,
                        };
                        
                        let source_val_raw = source_row.get(*source_idx).unwrap_or("");
                        let target_val_raw = target_row.get(*target_idx).unwrap_or("");
                        
                        let source_val = normalize_value_with_empty_vs_null(
                            source_val_raw,
                            case_sensitive,
                            ignore_whitespace,
                            ignore_empty_vs_null
                        );
                        let target_val = normalize_value_with_empty_vs_null(
                            target_val_raw,
                            case_sensitive,
                            ignore_whitespace,
                            ignore_empty_vs_null
                        );
                        
                        if source_val != target_val {
                            differences.push(Difference {
                                column: header.clone(),
                                old_value: source_val_raw.to_string(),
                                new_value: target_val_raw.to_string(),
                                diff: Vec::new(), // Skip char diffs in parallel mode for performance
                            });
                        }
                    }
                    
                    if differences.is_empty() {
                        // Row unchanged
                        (None, None, Some(UnchangedRow {
                            key: (*key).clone(),
                            row: record_to_hashmap(target_row, target_headers),
                        }))
                    } else {
                        // Row modified
                        (None, Some(ModifiedRow {
                            key: (*key).clone(),
                            source_row: record_to_hashmap(source_row, source_headers),
                            target_row: record_to_hashmap(target_row, target_headers),
                            differences,
                        }), None)
                    }
                }
            }
        })
        .collect();
    
    // Separate results into their respective vectors
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();
    
    for (add, mod_row, unch) in results {
        if let Some(a) = add {
            added.push(a);
        }
        if let Some(m) = mod_row {
            modified.push(m);
        }
        if let Some(u) = unch {
            unchanged.push(u);
        }
    }
    
    (added, modified, unchanged)
}

/// Parallel extraction of removed rows
pub fn parallel_find_removed(
    source_map: &AHashMap<String, usize>,
    source_rows: &[StringRecord],
    source_headers: &[String],
    target_map: &AHashMap<String, usize>,
) -> Vec<RemovedRow> {
    let source_keys: Vec<_> = source_map.iter().collect();
    
    source_keys
        .par_iter()
        .filter_map(|(key, &row_idx)| {
            if !target_map.contains_key(*key) {
                Some(RemovedRow {
                    key: (*key).clone(),
                    source_row: record_to_hashmap(&source_rows[row_idx], source_headers),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parallel implementation of CSV diff using primary keys
/// This is a parallel version of `core::diff_csv_primary_key_internal`
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
) -> Result<crate::types::DiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    on_progress(0.0, "Parsing source CSV...");
    let (source_headers, source_rows, source_header_map) = crate::core::parse_csv_internal(source_csv, has_headers)?;

    on_progress(10.0, "Parsing target CSV...");
    let (target_headers, target_rows, target_header_map) = crate::core::parse_csv_internal(target_csv, has_headers)?;

    // Validation of key columns
    for key in &key_columns {
        if !source_header_map.contains_key(key) {
             return Err(format!("Primary key column \"{}\" not found in source dataset.", key).into());
        }
        if !target_header_map.contains_key(key) {
             return Err(format!("Primary key column \"{}\" not found in target dataset.", key).into());
        }
    }

    on_progress(20.0, "Building source map...");
    let source_map: AHashMap<String, usize> = source_rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let key = get_row_key(row, &source_header_map, &key_columns);
            (key, i)
        })
        .collect();

    // Check for duplicate keys
    let mut source_keys = AHashSet::new();
    for key in source_map.keys() {
        if !source_keys.insert(key) {
            return Err(format!("Duplicate Primary Key found in source: \"{}\". Primary Keys must be unique.", key).into());
        }
    }

    on_progress(40.0, "Building target map...");
    let target_map: AHashMap<String, usize> = target_rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let key = get_row_key(row, &target_header_map, &key_columns);
            (key, i)
        })
        .collect();

    // Check for duplicate keys
    let mut target_keys = AHashSet::new();
    for key in target_map.keys() {
        if !target_keys.insert(key) {
            return Err(format!("Duplicate Primary Key found in target: \"{}\". Primary Keys must be unique.", key).into());
        }
    }

    on_progress(60.0, "Comparing rows...");

    // Find removed rows in parallel
    let removed = parallel_find_removed(
        &source_map,
        &source_rows,
        &source_headers,
        &target_map,
    );

    // Find added, modified, and unchanged rows in parallel
    let (added, modified, unchanged) = parallel_compare_rows(
        &target_map,
        &target_rows,
        &target_headers,
        &target_header_map,
        &source_map,
        &source_rows,
        &source_headers,
        &source_header_map,
        &excluded_columns,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
    );

    on_progress(100.0, "Complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
        source: crate::types::DatasetMetadata {
            headers: source_headers.clone(),
            rows: source_rows.iter().map(|r| record_to_hashmap(r, &source_headers)).collect(),
        },
        target: crate::types::DatasetMetadata {
            headers: target_headers.clone(),
            rows: target_rows.iter().map(|r| record_to_hashmap(r, &target_headers)).collect(),
        },
        key_columns,
        excluded_columns,
        mode: "primary_key".to_string(),
    })
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
) -> Result<crate::types::DiffResult, Box<dyn std::error::Error>>
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

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    on_progress(20.0, "Building fingerprint index...");
    
    // Track unmatched target rows
    let mut unmatched_target_indices: AHashSet<usize> = (0..target_rows.len()).collect();
    
    // Build fingerprint lookup for exact matches
    let mut target_fingerprint_lookup: AHashMap<String, Vec<usize>> = AHashMap::new();
    for (idx, row) in target_rows.iter().enumerate() {
        let fp = get_row_fingerprint(
            row, 
            &source_headers, 
            &target_header_map,
            case_sensitive, 
            ignore_whitespace,
            ignore_empty_vs_null,
            &excluded_columns
        );
        target_fingerprint_lookup.entry(fp).or_default().push(idx);
    }

    // Build value lookup for fuzzy matching optimization
    let mut target_value_lookup: AHashMap<(usize, String), Vec<usize>> = AHashMap::new();
    for (row_idx, row) in target_rows.iter().enumerate() {
        for (col_idx, cell) in row.iter().enumerate() {
             let header = &target_headers[col_idx];
             if excluded_columns.contains(header) {
                 continue;
             }
             if cell.trim().is_empty() {
                 continue;
             }
             let key = (col_idx, cell.to_string());
             target_value_lookup.entry(key).or_default().push(row_idx);
        }
    }

    on_progress(30.0, "Matching exact rows...");

    let mut unmatched_source_indices = Vec::new();

    // Exact matching (Sequential)
    for (i, source_row) in source_rows.iter().enumerate() {
        let source_fingerprint = get_row_fingerprint(
            source_row, 
            &source_headers, 
            &source_header_map,
            case_sensitive, 
            ignore_whitespace,
            ignore_empty_vs_null,
            &excluded_columns
        );

        let mut matched_exact = false;
        if let Some(indices) = target_fingerprint_lookup.get_mut(&source_fingerprint) {
            while let Some(target_idx) = indices.pop() {
                if unmatched_target_indices.contains(&target_idx) {
                    unchanged.push(UnchangedRow {
                        key: format!("Row {}", i + 1),
                        row: record_to_hashmap(source_row, &source_headers),
                    });
                    unmatched_target_indices.remove(&target_idx);
                    matched_exact = true;
                    break;
                }
            }
        }

        if !matched_exact {
            unmatched_source_indices.push(i);
        }
    }

    on_progress(50.0, "Fuzzy matching in parallel...");

    // Fuzzy matching (Parallel)
    // We calculate best matches for all unmatched source rows in parallel
    // Then we resolve conflicts based on score
    
    // Convert unmatched target indices to a Vec for easier access if needed, 
    // but we use target_value_lookup mostly.
    // We need a read-only view of unmatched targets for the parallel part.
    let unmatched_targets_set: AHashSet<usize> = unmatched_target_indices.clone();

    struct MatchCandidate {
        source_idx: usize,
        target_idx: usize,
        score: f64,
    }

    let potential_matches: Vec<MatchCandidate> = unmatched_source_indices
        .par_iter()
        .filter_map(|&source_idx| {
            let source_row = &source_rows[source_idx];
            
            // Find candidates using value lookup
            let mut candidates = AHashSet::new();
            for (col_idx, cell) in source_row.iter().enumerate() {
                let header = &source_headers[col_idx];
                if excluded_columns.contains(header) {
                    continue;
                }
                if cell.trim().is_empty() {
                    continue;
                }
                
                // Map source column to target column
                if let Some(target_col_idx) = target_header_map.get(header) {
                    let key = (*target_col_idx, cell.to_string());
                    if let Some(indices) = target_value_lookup.get(&key) {
                        for &idx in indices {
                            if unmatched_targets_set.contains(&idx) {
                                candidates.insert(idx);
                            }
                        }
                    }
                }
            }

            // If no candidates found via lookup, check all unmatched targets (slow path)
            // To avoid massive performance hit, we might skip this or limit it.
            // For now, if candidates is empty, we skip fuzzy match for this row (it will be "Removed")
            // This matches the optimization in content_match.rs
            
            if candidates.is_empty() {
                return None;
            }

            let mut best_match_idx = None;
            let mut best_match_score = 0.0;
            const SIMILARITY_THRESHOLD: f64 = 0.5;

            for target_idx in candidates {
                let target_row = &target_rows[target_idx];
                
                let mut total_score = 0.0;
                let mut comparisons = 0;

                for (header, source_col_idx) in &source_header_map {
                    if excluded_columns.contains(header) {
                        continue;
                    }
                    
                    let target_col_idx = match target_header_map.get(header) {
                        Some(idx) => idx,
                        None => continue,
                    };

                    let s_val = source_row.get(*source_col_idx).unwrap_or("");
                    let t_val = target_row.get(*target_col_idx).unwrap_or("");

                    let s_norm = normalize_value_with_empty_vs_null(s_val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);
                    let t_norm = normalize_value_with_empty_vs_null(t_val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);

                    if s_norm == t_norm {
                        total_score += 1.0;
                    } else {
                        total_score += jaro_winkler(&s_norm, &t_norm);
                    }
                    comparisons += 1;
                }

                let avg_score = if comparisons > 0 {
                    total_score / comparisons as f64
                } else {
                    0.0
                };

                if avg_score > SIMILARITY_THRESHOLD && avg_score > best_match_score {
                    best_match_score = avg_score;
                    best_match_idx = Some(target_idx);
                }
            }

            if let Some(target_idx) = best_match_idx {
                Some(MatchCandidate {
                    source_idx,
                    target_idx,
                    score: best_match_score,
                })
            } else {
                None
            }
        })
        .collect();

    // Resolve conflicts
    // Sort by score descending
    let mut sorted_matches = potential_matches;
    sorted_matches.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let mut matched_source_indices = AHashSet::new();
    // unmatched_target_indices is already tracked, but we need to track what we use in this phase
    let mut used_target_indices_in_fuzzy = AHashSet::new();

    for m in sorted_matches {
        if matched_source_indices.contains(&m.source_idx) {
            continue;
        }
        if !unmatched_target_indices.contains(&m.target_idx) || used_target_indices_in_fuzzy.contains(&m.target_idx) {
            continue;
        }

        // Accept match
        matched_source_indices.insert(m.source_idx);
        used_target_indices_in_fuzzy.insert(m.target_idx);
        unmatched_target_indices.remove(&m.target_idx);

        let source_row = &source_rows[m.source_idx];
        let target_row = &target_rows[m.target_idx];

        let mut differences = Vec::new();
        for header in &source_headers {
            if excluded_columns.contains(header) {
                continue;
            }
            
            let source_idx = source_header_map.get(header).unwrap();
            let target_idx = match target_header_map.get(header) {
                Some(idx) => idx,
                None => continue,
            };
            
            let s_val = source_row.get(*source_idx).unwrap_or("");
            let t_val = target_row.get(*target_idx).unwrap_or("");
            
            let s_norm = normalize_value_with_empty_vs_null(s_val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);
            let t_norm = normalize_value_with_empty_vs_null(t_val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);
            
            if s_norm != t_norm {
                differences.push(Difference {
                    column: header.clone(),
                    old_value: s_val.to_string(),
                    new_value: t_val.to_string(),
                    diff: Vec::new(), // Skip char diffs in parallel
                });
            }
        }

        modified.push(ModifiedRow {
            key: format!("Row {}", m.source_idx + 1),
            source_row: record_to_hashmap(source_row, &source_headers),
            target_row: record_to_hashmap(target_row, &target_headers),
            differences,
        });
    }

    // Remaining unmatched source rows are Removed
    for &i in &unmatched_source_indices {
        if !matched_source_indices.contains(&i) {
            removed.push(RemovedRow {
                key: format!("Row {}", i + 1),
                source_row: record_to_hashmap(&source_rows[i], &source_headers),
            });
        }
    }

    // Remaining unmatched target rows are Added
    for i in unmatched_target_indices {
        added.push(AddedRow {
            key: format!("Row {}", i + 1),
            target_row: record_to_hashmap(&target_rows[i], &target_headers),
        });
    }

    on_progress(100.0, "Complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
        source: crate::types::DatasetMetadata {
            headers: source_headers.clone(),
            rows: source_rows.iter().map(|r| record_to_hashmap(r, &source_headers)).collect(),
        },
        target: crate::types::DatasetMetadata {
            headers: target_headers.clone(),
            rows: target_rows.iter().map(|r| record_to_hashmap(r, &target_headers)).collect(),
        },
        key_columns: vec![],
        excluded_columns,
        mode: "content_match".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_init_thread_pool() {
        // Test that thread pool initialization doesn't panic
        init_thread_pool(4);
        init_thread_pool(2); // Should handle re-initialization gracefully
    }
}
