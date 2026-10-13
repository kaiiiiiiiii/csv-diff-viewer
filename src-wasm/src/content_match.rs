use crate::types::*;
use crate::utils::*;
use super::parse::parse_csv_streaming;
use ahash::{AHashMap, AHashSet};

pub fn diff_csv_internal<F>(
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
    // Use streaming parser for better memory efficiency and progress reporting
    let (source_headers, source_rows, source_header_map) = parse_csv_streaming(
        source_csv, 
        has_headers, 
        5000,
        |percent, message| {
            on_progress(percent * 0.1, &format!("Source: {}", message)); // Scale to 0-10%
        }
    )?;

    let (target_headers_orig, target_rows_orig, target_header_map_orig) = parse_csv_streaming(
        target_csv, 
        has_headers, 
        5000,
        |percent, message| {
            on_progress(10.0 + percent * 0.1, &format!("Target: {}", message)); // Scale to 10-20%
        }
    )?;

    let (target_headers, target_rows, target_header_map) = if source_headers != target_headers_orig && source_headers.len() == target_headers_orig.len() {
        (source_headers.clone(), target_rows_orig, source_header_map.clone())
    } else {
        (target_headers_orig, target_rows_orig, target_header_map_orig)
    };

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    on_progress(20.0, "Building fingerprint index for exact matches...");

    // Use HashSet for excluded columns for O(1) lookup
    let excluded_set: AHashSet<String> = excluded_columns.iter().cloned().collect();

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

    // Track unmatched target rows
    let mut unmatched_target_indices: AHashSet<usize> = (0..target_rows.len()).collect();

    // Build fingerprint lookup for exact matches only (optimized)
    let mut target_fingerprint_lookup: AHashMap<String, Vec<usize>> = AHashMap::new();
    for (idx, row) in target_rows.iter().enumerate() {
        let fp = crate::utils::get_row_fingerprint_fast(
            row,
            &source_headers,
            &target_header_map,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            &excluded_set
        );
        target_fingerprint_lookup.entry(fp).or_default().push(idx);
    }

    // Build value lookup for fuzzy matching optimization
    let mut target_value_lookup: AHashMap<(usize, String), Vec<usize>> = AHashMap::new();
    for (row_idx, row) in target_rows.iter().enumerate() {
        for (col_idx, cell) in row.iter().enumerate() {
            let header = &target_headers[col_idx];
            if excluded_set.contains(header) {
                continue;
            }
            let trimmed = cell.trim();
            if trimmed.is_empty() {
                continue;
            }
            target_value_lookup.entry((col_idx, index_value(cell))).or_default().push(row_idx);
        }
    }
    
    let mut row_counter = 1;
    let total_rows = source_rows.len();

    on_progress(30.0, "Matching rows using strsim algorithms...");

    for (i, source_row) in source_rows.iter().enumerate() {
        if i % 100 == 0 {
            let progress = 30.0 + (i as f64 / total_rows as f64) * 60.0;
            on_progress(progress, "Comparing rows with fuzzy matching...");
        }

        // First try exact match via fingerprint
        let source_fingerprint = crate::utils::get_row_fingerprint_fast(
            source_row,
            &source_headers,
            &source_header_map,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            &excluded_set
        );

        let mut matched_exact = false;
        if let Some(indices) = target_fingerprint_lookup.get_mut(&source_fingerprint) {
            while let Some(target_idx) = indices.pop() {
                if unmatched_target_indices.contains(&target_idx) {
                    unchanged.push(UnchangedRow {
                        key: format!("Row {}", row_counter),
                        row: record_to_hashmap(source_row, &source_headers),
                    });
                    unmatched_target_indices.remove(&target_idx);
                    matched_exact = true;
                    break;
                }
            }
        }

        // If no exact match, use strsim-based fuzzy matching
        if !matched_exact {
            let mut best_match_idx: Option<usize> = None;
            let mut best_similarity_score = 0.0;

            // Optimization: Find candidates that share at least one value
            let mut candidates: AHashSet<usize> = AHashSet::new();
            
            for (col_idx, cell) in source_row.iter().enumerate() {
                let header = &source_headers[col_idx];
                if excluded_set.contains(header) {
                    continue;
                }
                if cell.trim().is_empty() {
                    continue;
                }
                
                if let Some(&target_col_idx) = target_header_map.get(header) {
                     let key = (target_col_idx, index_value(cell));
                     if let Some(indices) = target_value_lookup.get(&key) {
                         for &idx in indices {
                             if unmatched_target_indices.contains(&idx) {
                                 candidates.insert(idx);
                             }
                         }
                     }
                }
            }

            // Calculate similarity only with candidates
            for &target_idx in candidates.iter() {
                let target_row = &target_rows[target_idx];
                
                let similarity = calculate_row_similarity(
                    source_row,
                    target_row,
                    &source_headers,
                    &source_header_map,
                    &target_header_map,
                    &excluded_columns,
                );

                if similarity > best_similarity_score {
                    best_similarity_score = similarity;
                    best_match_idx = Some(target_idx);
                }
            }

            // Threshold for considering a match (50% similarity)
            if let Some(idx) = best_match_idx {
                if best_similarity_score > 0.5 {
                    let target_row = &target_rows[idx];
                    let mut differences = Vec::new();

                    for header in &source_headers {
                        if excluded_set.contains(header) {
                            continue;
                        }

                        let source_idx = source_header_map.get(header).unwrap();
                        let target_idx = match target_header_map.get(header) {
                            Some(idx) => idx,
                            None => continue,
                        };

                        let source_val_raw = source_row.get(*source_idx).unwrap_or("");
                        let target_val_raw = target_row.get(*target_idx).unwrap_or("");

                        let source_val = normalize_value_cow(
                            source_val_raw,
                            case_sensitive,
                            ignore_whitespace,
                            ignore_empty_vs_null
                        );
                        let target_val = normalize_value_cow(
                            target_val_raw,
                            case_sensitive,
                            ignore_whitespace,
                            ignore_empty_vs_null
                        );

                        if source_val != target_val {
                            let diffs = crate::core::diff_text_internal(source_val_raw, target_val_raw, case_sensitive);

                            differences.push(Difference {
                                column: header.clone(),
                                old_value: source_val_raw.to_string(),
                                new_value: target_val_raw.to_string(),
                                diff: diffs,
                            });
                        }
                    }

                    modified.push(ModifiedRow {
                        key: format!("Row {}", row_counter),
                        source_row: record_to_hashmap(source_row, &source_headers),
                        target_row: record_to_hashmap(target_row, &target_headers),
                        differences,
                    });
                    unmatched_target_indices.remove(&idx);
                } else {
                    // Similarity too low, consider as removed
                    removed.push(RemovedRow {
                        key: format!("Removed {}", removed.len() + 1),
                        source_row: record_to_hashmap(source_row, &source_headers),
                    });
                }
            } else {
                // No candidates at all
                removed.push(RemovedRow {
                    key: format!("Removed {}", removed.len() + 1),
                    source_row: record_to_hashmap(source_row, &source_headers),
                });
            }
        }
        row_counter += 1;
    }

    // All remaining unmatched target rows are added
    on_progress(90.0, "Processing remaining rows...");
    let mut added_index = 1;
    let mut remaining_indices: Vec<_> = unmatched_target_indices.into_iter().collect();
    remaining_indices.sort();

    for idx in remaining_indices {
        let row = &target_rows[idx];
        added.push(AddedRow {
            key: format!("Added {}", added_index),
            target_row: record_to_hashmap(row, &target_headers),
        });
        added_index += 1;
    }

    on_progress(100.0, "Comparison complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
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

    fn run(src: &str, tgt: &str, case_sensitive: bool) -> DiffResult {
        diff_csv_internal(src, tgt, case_sensitive, true, false, vec![], true, |_, _| {}).unwrap()
    }

    #[test]
    fn fuzzy_probe_uses_normalized_values_for_case_insensitive() {
        // Rows differ in "city" and share "name" only in a different case,
        // so the match must be found via the normalized candidate index.
        let src = "name,city,note\nALICE,Berlin,hello world\n";
        let tgt = "name,city,note\nalice,Berlino,hello worlds\n";
        let r = run(src, tgt, false);
        assert_eq!(r.modified.len(), 1);
        assert!(r.added.is_empty() && r.removed.is_empty());
    }

    #[test]
    fn fuzzy_probe_case_sensitive_still_exact() {
        let src = "name,city,note\nALICE,Berlin,hello world\n";
        let tgt = "name,city,note\nalice,Berlino,hello worlds\n";
        let r = run(src, tgt, true);
        // No shared exact value, so no candidates: removed + added
        assert_eq!(r.removed.len(), 1);
        assert_eq!(r.added.len(), 1);
    }
}
