use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use csv::ReaderBuilder;

#[derive(Serialize, Deserialize)]
pub struct DiffResult {
    added: Vec<AddedRow>,
    removed: Vec<RemovedRow>,
    modified: Vec<ModifiedRow>,
    unchanged: Vec<UnchangedRow>,
    source: DatasetMetadata,
    target: DatasetMetadata,
    keyColumns: Vec<String>,
    excludedColumns: Vec<String>,
    mode: String,
}

#[derive(Serialize, Deserialize)]
struct DatasetMetadata {
    headers: Vec<String>,
    rows: Vec<HashMap<String, String>>, 
}

#[derive(Serialize, Deserialize, Clone)]
struct AddedRow {
    key: String,
    targetRow: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct RemovedRow {
    key: String,
    sourceRow: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct UnchangedRow {
    key: String,
    row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ModifiedRow {
    key: String,
    sourceRow: HashMap<String, String>,
    targetRow: HashMap<String, String>,
    differences: Vec<Difference>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Difference {
    column: String,
    oldValue: String,
    newValue: String,
    // We omit detailed diffs for performance, JS side handles simple display
}

fn normalize_value(value: &str, case_sensitive: bool, ignore_whitespace: bool) -> String {
    let mut val = value.to_string();
    if ignore_whitespace {
        val = val.trim().to_string();
    }
    if !case_sensitive {
        val = val.to_lowercase();
    }
    val
}

fn get_row_fingerprint(
    row: &HashMap<String, String>,
    headers: &[String],
    case_sensitive: bool,
    ignore_whitespace: bool,
    excluded_columns: &[String],
) -> String {
    headers.iter()
        .filter(|h| !excluded_columns.contains(h))
        .map(|h| {
            let val = row.get(h).map(|s| s.as_str()).unwrap_or("");
            normalize_value(val, case_sensitive, ignore_whitespace)
        })
        .collect::<Vec<_>>()
        .join("||")
}

#[wasm_bindgen]
pub fn diff_csv(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    excluded_columns_val: JsValue,
) -> Result<JsValue, JsValue> {
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut source_rdr = ReaderBuilder::new()
        .has_headers(true)
        .from_reader(source_csv.as_bytes());
    
    let mut target_rdr = ReaderBuilder::new()
        .has_headers(true)
        .from_reader(target_csv.as_bytes());

    let source_headers: Vec<String> = source_rdr.headers()
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        .iter()
        .map(|s| s.to_string())
        .collect();

    let target_headers: Vec<String> = target_rdr.headers()
        .map_err(|e| JsValue::from_str(&e.to_string()))?
        .iter()
        .map(|s| s.to_string())
        .collect();

    let source_rows: Vec<HashMap<String, String>> = source_rdr.deserialize()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let target_rows: Vec<HashMap<String, String>> = target_rdr.deserialize()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    // Use a map for unmatched target rows for faster lookup
    // Key: index, Value: row
    let mut unmatched_target_map: HashMap<usize, &HashMap<String, String>> = target_rows.iter().enumerate().collect();
    
    let mut row_counter = 1;

    for source_row in &source_rows {
        let source_fingerprint = get_row_fingerprint(
            source_row, 
            &source_headers, 
            case_sensitive, 
            ignore_whitespace, 
            &excluded_columns
        );

        let mut best_match_idx: Option<usize> = None;
        let mut best_score = 0.0;

        // First pass: Exact match
        for (&idx, target_row) in &unmatched_target_map {
            let target_fingerprint = get_row_fingerprint(
                target_row, 
                &source_headers, // Use source headers for comparison
                case_sensitive, 
                ignore_whitespace, 
                &excluded_columns
            );

            if source_fingerprint == target_fingerprint {
                best_match_idx = Some(idx);
                best_score = 1.0;
                break;
            }
        }

        // Second pass: Similarity match if no exact match
        if best_match_idx.is_none() {
            for (&idx, target_row) in &unmatched_target_map {
                let mut matching_fields = 0;
                let mut total_fields = 0;

                for header in &source_headers {
                    if excluded_columns.contains(header) {
                        continue;
                    }
                    total_fields += 1;
                    
                    let source_val = normalize_value(
                        source_row.get(header).map(|s| s.as_str()).unwrap_or(""),
                        case_sensitive,
                        ignore_whitespace
                    );
                    let target_val = normalize_value(
                        target_row.get(header).map(|s| s.as_str()).unwrap_or(""),
                        case_sensitive,
                        ignore_whitespace
                    );

                    if source_val == target_val {
                        matching_fields += 1;
                    }
                }

                let score = if total_fields > 0 {
                    matching_fields as f64 / total_fields as f64
                } else {
                    0.0
                };

                if score > best_score {
                    best_score = score;
                    best_match_idx = Some(idx);
                }
            }
        }

        if let Some(idx) = best_match_idx {
            if best_score == 1.0 {
                unchanged.push(UnchangedRow {
                    key: format!("Row {}", row_counter),
                    row: source_row.clone(),
                });
                unmatched_target_map.remove(&idx);
            } else if best_score > 0.5 {
                let target_row = unmatched_target_map.get(&idx).unwrap();
                let mut differences = Vec::new();

                for header in &source_headers {
                    if excluded_columns.contains(header) {
                        continue;
                    }

                    let source_val = normalize_value(
                        source_row.get(header).map(|s| s.as_str()).unwrap_or(""),
                        case_sensitive,
                        ignore_whitespace
                    );
                    let target_val = normalize_value(
                        target_row.get(header).map(|s| s.as_str()).unwrap_or(""),
                        case_sensitive,
                        ignore_whitespace
                    );

                    if source_val != target_val {
                        differences.push(Difference {
                            column: header.clone(),
                            oldValue: source_row.get(header).cloned().unwrap_or_default(),
                            newValue: target_row.get(header).cloned().unwrap_or_default(),
                        });
                    }
                }

                modified.push(ModifiedRow {
                    key: format!("Row {}", row_counter),
                    sourceRow: source_row.clone(),
                    targetRow: (*target_row).clone(),
                    differences,
                });
                unmatched_target_map.remove(&idx);
            } else {
                removed.push(RemovedRow {
                    key: format!("Removed {}", removed.len() + 1), // This logic might differ slightly from JS but is acceptable
                    sourceRow: source_row.clone(),
                });
            }
        } else {
             removed.push(RemovedRow {
                key: format!("Removed {}", removed.len() + 1),
                sourceRow: source_row.clone(),
            });
        }
        row_counter += 1;
    }

    // Remaining target rows are added
    let mut added_index = 1;
    // We need to sort by index to maintain order if possible, or just iterate
    // HashMap iteration is arbitrary. To be deterministic, we might want to sort by original index.
    let mut remaining_indices: Vec<_> = unmatched_target_map.keys().cloned().collect();
    remaining_indices.sort();

    for idx in remaining_indices {
        let row = unmatched_target_map.get(&idx).unwrap();
        added.push(AddedRow {
            key: format!("Added {}", added_index),
            targetRow: (*row).clone(),
        });
        added_index += 1;
    }

    let result = DiffResult {
        added,
        removed,
        modified,
        unchanged,
        source: DatasetMetadata {
            headers: source_headers,
            rows: source_rows,
        },
        target: DatasetMetadata {
            headers: target_headers,
            rows: target_rows,
        },
        keyColumns: vec![],
        excludedColumns: excluded_columns,
        mode: "content-match".to_string(),
    };

    Ok(serde_wasm_bindgen::to_value(&result)?)
}
