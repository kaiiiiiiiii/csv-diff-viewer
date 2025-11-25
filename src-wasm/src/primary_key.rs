use crate::types::*;
use crate::utils::*;
use super::parse::parse_csv_streaming;
use ahash::{AHashMap};

pub fn diff_csv_primary_key_internal<F>(
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
    // Use streaming parser for better memory efficiency and progress reporting
    let (source_headers, source_rows, source_header_map) = parse_csv_streaming(
        source_csv, 
        has_headers, 
        5000,
        |percent, message| {
            on_progress(percent * 0.1, &format!("Source: {}", message)); // Scale to 0-10%
        }
    )?;

    let (target_headers, target_rows, target_header_map) = parse_csv_streaming(
        target_csv, 
        has_headers, 
        5000,
        |percent, message| {
            on_progress(10.0 + percent * 0.1, &format!("Target: {}", message)); // Scale to 10-20%
        }
    )?;

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
    let mut source_map: AHashMap<String, usize> = AHashMap::new();
    for (i, row) in source_rows.iter().enumerate() {
        let key = get_row_key(row, &source_header_map, &key_columns);
        if source_map.contains_key(&key) {
             return Err(format!("Duplicate Primary Key found in source: \"{}\". Primary Keys must be unique.", key).into());
        }
        source_map.insert(key, i);
    }

    on_progress(40.0, "Building target map...");
    let mut target_map: AHashMap<String, usize> = AHashMap::new();
    for (i, row) in target_rows.iter().enumerate() {
        let key = get_row_key(row, &target_header_map, &key_columns);
        if target_map.contains_key(&key) {
             return Err(format!("Duplicate Primary Key found in target: \"{}\". Primary Keys must be unique.", key).into());
        }
        target_map.insert(key, i);
    }

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    on_progress(60.0, "Comparing rows...");

    // Find removed
    for (key, &row_idx) in &source_map {
        if !target_map.contains_key(key) {
            removed.push(RemovedRow {
                key: key.clone(),
                source_row: record_to_hashmap(&source_rows[row_idx], &source_headers),
            });
        }
    }

    // Find added and modified
    let total_target = target_map.len();
    for (i, (key, &target_row_idx)) in target_map.iter().enumerate() {
        if i % 1000 == 0 {
             let p = 60.0 + (i as f64 / total_target as f64) * 30.0;
             on_progress(p, "Comparing rows...");
        }

        let target_row = &target_rows[target_row_idx];

        match source_map.get(key) {
            None => {
                added.push(AddedRow {
                    key: key.clone(),
                    target_row: record_to_hashmap(target_row, &target_headers),
                });
            }
            Some(&source_row_idx) => {
                let source_row = &source_rows[source_row_idx];
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
                        let diffs = crate::core::diff_text_internal(source_val_raw, target_val_raw, case_sensitive);

                        differences.push(Difference {
                            column: header.clone(),
                            old_value: source_val_raw.to_string(),
                            new_value: target_val_raw.to_string(),
                            diff: diffs,
                        });
                    }
                }

                if !differences.is_empty() {
                    modified.push(ModifiedRow {
                        key: key.clone(),
                        source_row: record_to_hashmap(source_row, &source_headers),
                        target_row: record_to_hashmap(target_row, &target_headers),
                        differences,
                    });
                } else {
                    unchanged.push(UnchangedRow {
                        key: key.clone(),
                        row: record_to_hashmap(source_row, &source_headers),
                    });
                }
            }
        }
    }

    on_progress(100.0, "Comparison complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
        source: DatasetMetadata {
            headers: source_headers.clone(),
            rows: source_rows.iter().map(|r| record_to_hashmap(r, &source_headers)).collect(),
        },
        target: DatasetMetadata {
            headers: target_headers.clone(),
            rows: target_rows.iter().map(|r| record_to_hashmap(r, &target_headers)).collect(),
        },
        key_columns,
        excluded_columns,
        mode: "primary-key".to_string(),
    })
    }