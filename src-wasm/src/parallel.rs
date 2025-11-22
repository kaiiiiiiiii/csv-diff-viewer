/// Parallel processing module for multi-threaded CSV operations
/// Uses wasm-bindgen-rayon for web worker-based parallelism
use rayon::prelude::*;
use csv::StringRecord;
use ahash::AHashMap;
use crate::types::{AddedRow, RemovedRow, ModifiedRow, UnchangedRow, Difference};
use crate::utils::{record_to_hashmap, normalize_value_with_empty_vs_null};

/// Initialize the rayon thread pool for parallel processing
/// This must be called from JavaScript with the number of worker threads
pub fn init_thread_pool(num_threads: usize) {
    rayon::ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build_global()
        .ok(); // Ignore error if already initialized
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
    // Convert HashMap to Vec for parallel iteration
    let target_keys: Vec<_> = target_map.iter().collect();
    
    // Process in parallel using rayon
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
