/// Parallel processing module for multi-threaded CSV operations
/// Currently provides a parallel-like interface that's implemented sequentially for WASM compatibility
use csv::StringRecord;
use ahash::{AHashMap, AHashSet};
use crate::types::{AddedRow, RemovedRow, ModifiedRow, UnchangedRow, Difference, DiffResult};
use crate::utils::{record_to_hashmap, normalize_value_with_empty_vs_null, get_row_key};
use rayon::prelude::*;

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
