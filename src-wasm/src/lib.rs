use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};
use csv::ReaderBuilder;
use js_sys::Function;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    added: Vec<AddedRow>,
    removed: Vec<RemovedRow>,
    modified: Vec<ModifiedRow>,
    unchanged: Vec<UnchangedRow>,
    source: DatasetMetadata,
    target: DatasetMetadata,
    key_columns: Vec<String>,
    excluded_columns: Vec<String>,
    mode: String,
}

#[derive(Serialize, Deserialize)]
struct DatasetMetadata {
    headers: Vec<String>,
    rows: Vec<HashMap<String, String>>, 
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AddedRow {
    key: String,
    target_row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemovedRow {
    key: String,
    source_row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct UnchangedRow {
    key: String,
    row: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModifiedRow {
    key: String,
    source_row: HashMap<String, String>,
    target_row: HashMap<String, String>,
    differences: Vec<Difference>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Difference {
    column: String,
    old_value: String,
    new_value: String,
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

fn diff_csv_internal<F>(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    excluded_columns: Vec<String>,
    has_headers: bool,
    mut on_progress: F,
) -> Result<DiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    let mut source_rdr = ReaderBuilder::new()
        .has_headers(has_headers)
        .from_reader(source_csv.as_bytes());
    
    let mut target_rdr = ReaderBuilder::new()
        .has_headers(has_headers)
        .from_reader(target_csv.as_bytes());

    on_progress(0.0, "Parsing source CSV...");
    
    let (source_headers, source_rows) = if has_headers {
        let headers: Vec<String> = source_rdr.headers()?
            .iter()
            .map(|s| s.to_string())
            .collect();
        let rows: Vec<HashMap<String, String>> = source_rdr.deserialize()
            .collect::<Result<Vec<_>, _>>()?;
        (headers, rows)
    } else {
        let records: Vec<csv::StringRecord> = source_rdr.records()
            .collect::<Result<Vec<_>, _>>()?;
        
        if records.is_empty() {
            (vec![], vec![])
        } else {
            let col_count = records[0].len();
            let headers: Vec<String> = (0..col_count)
                .map(|i| format!("Column{}", i + 1))
                .collect();
            
            let rows: Vec<HashMap<String, String>> = records.into_iter()
                .map(|record| {
                    headers.iter().zip(record.iter())
                        .map(|(h, v)| (h.clone(), v.to_string()))
                        .collect()
                })
                .collect();
            (headers, rows)
        }
    };

    on_progress(10.0, "Parsing target CSV...");
    
    let (target_headers, target_rows) = if has_headers {
        let headers: Vec<String> = target_rdr.headers()?
            .iter()
            .map(|s| s.to_string())
            .collect();
        let rows: Vec<HashMap<String, String>> = target_rdr.deserialize()
            .collect::<Result<Vec<_>, _>>()?;
        (headers, rows)
    } else {
        let records: Vec<csv::StringRecord> = target_rdr.records()
            .collect::<Result<Vec<_>, _>>()?;
        
        if records.is_empty() {
            (vec![], vec![])
        } else {
            let col_count = records[0].len();
            let headers: Vec<String> = (0..col_count)
                .map(|i| format!("Column{}", i + 1))
                .collect();
            
            let rows: Vec<HashMap<String, String>> = records.into_iter()
                .map(|record| {
                    headers.iter().zip(record.iter())
                        .map(|(h, v)| (h.clone(), v.to_string()))
                        .collect()
                })
                .collect();
            (headers, rows)
        }
    };

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    on_progress(20.0, "Indexing target rows...");
    
    // Track available target rows by index
    let mut unmatched_target_indices: HashSet<usize> = (0..target_rows.len()).collect();
    
    // Build lookup for exact matches: Fingerprint -> Vec<TargetIndex>
    let mut target_fingerprint_lookup: HashMap<String, Vec<usize>> = HashMap::new();
    
    // Build inverted index for similarity search: (ColumnIndex, Value) -> Vec<TargetIndex>
    // Only index columns that are not excluded
    let mut inverted_index: HashMap<(usize, String), Vec<usize>> = HashMap::new();

    for (idx, row) in target_rows.iter().enumerate() {
        let fp = get_row_fingerprint(
            row, 
            &source_headers, 
            case_sensitive, 
            ignore_whitespace, 
            &excluded_columns
        );
        target_fingerprint_lookup.entry(fp).or_default().push(idx);

        // Populate inverted index
        for (col_idx, header) in source_headers.iter().enumerate() {
            if excluded_columns.contains(header) {
                continue;
            }
            if let Some(val) = row.get(header) {
                let norm_val = normalize_value(val, case_sensitive, ignore_whitespace);
                inverted_index.entry((col_idx, norm_val)).or_default().push(idx);
            }
        }
    }
    
    let mut row_counter = 1;
    let total_rows = source_rows.len();

    for (i, source_row) in source_rows.iter().enumerate() {
        // Report progress
        if i % 100 == 0 {
            let progress = 20.0 + (i as f64 / total_rows as f64) * 70.0;
            on_progress(progress, "Comparing rows...");
        }

        let source_fingerprint = get_row_fingerprint(
            source_row, 
            &source_headers, 
            case_sensitive, 
            ignore_whitespace, 
            &excluded_columns
        );

        let mut matched_exact = false;

        // First pass: Exact match using lookup
        if let Some(indices) = target_fingerprint_lookup.get_mut(&source_fingerprint) {
            // Find an index that hasn't been used yet
            while let Some(target_idx) = indices.pop() {
                if unmatched_target_indices.contains(&target_idx) {
                    // Found valid exact match
                    unchanged.push(UnchangedRow {
                        key: format!("Row {}", row_counter),
                        row: source_row.clone(),
                    });
                    unmatched_target_indices.remove(&target_idx);
                    matched_exact = true;
                    break;
                }
            }
        }

        // Second pass: Similarity match using inverted index
        if !matched_exact {
            let mut candidate_scores: HashMap<usize, usize> = HashMap::new();
            
            // Find candidates based on shared column values
            for (col_idx, header) in source_headers.iter().enumerate() {
                if excluded_columns.contains(header) {
                    continue;
                }
                
                let source_val = normalize_value(
                    source_row.get(header).map(|s| s.as_str()).unwrap_or(""),
                    case_sensitive,
                    ignore_whitespace
                );

                if let Some(target_indices) = inverted_index.get(&(col_idx, source_val)) {
                    for &target_idx in target_indices {
                        if unmatched_target_indices.contains(&target_idx) {
                            *candidate_scores.entry(target_idx).or_default() += 1;
                        }
                    }
                }
            }

            // Find best candidate
            let mut best_match_idx: Option<usize> = None;
            let mut best_score_count = 0;
            
            for (&idx, &score) in &candidate_scores {
                if score > best_score_count {
                    best_score_count = score;
                    best_match_idx = Some(idx);
                }
            }

            // Calculate actual score for the best candidate to verify
            let mut final_score = 0.0;
            if let Some(idx) = best_match_idx {
                let total_fields = source_headers.iter().filter(|h| !excluded_columns.contains(h)).count();
                if total_fields > 0 {
                    final_score = best_score_count as f64 / total_fields as f64;
                }
            }

            if let Some(idx) = best_match_idx {
                if final_score > 0.5 {
                    let target_row = &target_rows[idx];
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
                                old_value: source_row.get(header).cloned().unwrap_or_default(),
                                new_value: target_row.get(header).cloned().unwrap_or_default(),
                            });
                        }
                    }

                    modified.push(ModifiedRow {
                        key: format!("Row {}", row_counter),
                        source_row: source_row.clone(),
                        target_row: (*target_row).clone(),
                        differences,
                    });
                    unmatched_target_indices.remove(&idx);
                } else {
                    removed.push(RemovedRow {
                        key: format!("Removed {}", removed.len() + 1),
                        source_row: source_row.clone(),
                    });
                }
            } else {
                 removed.push(RemovedRow {
                    key: format!("Removed {}", removed.len() + 1),
                    source_row: source_row.clone(),
                });
            }
        }
        row_counter += 1;
    }

    // Remaining target rows are added
    let mut added_index = 1;
    let mut remaining_indices: Vec<_> = unmatched_target_indices.into_iter().collect();
    remaining_indices.sort();

    for idx in remaining_indices {
        let row = &target_rows[idx];
        added.push(AddedRow {
            key: format!("Added {}", added_index),
            target_row: (*row).clone(),
        });
        added_index += 1;
    }

    on_progress(100.0, "Comparison complete");

    Ok(DiffResult {
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
        key_columns: vec![],
        excluded_columns: excluded_columns,
        mode: "content-match".to_string(),
    })
}

#[wasm_bindgen]
pub fn diff_csv(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    excluded_columns_val: JsValue,
    has_headers: bool,
    on_progress: &Function,
) -> Result<JsValue, JsValue> {
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let callback = |progress: f64, message: &str| {
        let this = JsValue::NULL;
        let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
    };

    let result = diff_csv_internal(
        source_csv,
        target_csv,
        case_sensitive,
        ignore_whitespace,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diff_csv_progress() {
        let source = "id,name,age\n1,Alice,30\n2,Bob,25";
        let target = "id,name,age\n1,Alice,30\n2,Bobby,25";
        let excluded = vec![];
        
        let mut progress_called = false;
        let callback = |p: f64, m: &str| {
            progress_called = true;
            println!("Progress: {}%, {}", p, m);
        };

        let result = diff_csv_internal(source, target, true, true, excluded, true, callback).unwrap();
        
        assert!(progress_called);
        assert_eq!(result.modified.len(), 1);
        assert_eq!(result.unchanged.len(), 1);
    }
}
