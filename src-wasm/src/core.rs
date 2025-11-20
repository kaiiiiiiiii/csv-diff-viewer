use csv::{ReaderBuilder, StringRecord};
use ahash::{AHashMap, AHashSet};
use similar::{ChangeTag, TextDiff};
use crate::types::*;
use crate::utils::*;

pub fn parse_csv_internal(
    csv_content: &str,
    has_headers: bool,
) -> Result<(Vec<String>, Vec<StringRecord>, AHashMap<String, usize>), Box<dyn std::error::Error>> {
    let mut rdr = ReaderBuilder::new()
        .has_headers(has_headers)
        .trim(csv::Trim::All)
        .from_reader(csv_content.as_bytes());
    
    let headers: Vec<String>;
    let mut header_map: AHashMap<String, usize> = AHashMap::new();

    if has_headers {
        let header_record = rdr.headers()?;
        headers = header_record.iter().map(|s| s.to_string()).collect();
        for (i, h) in headers.iter().enumerate() {
            header_map.insert(h.clone(), i);
        }
    } else {
        // We need to peek at the first record to determine column count if no headers
        // But csv crate doesn't support peeking easily without consuming.
        // However, if has_headers is false, rdr.headers() returns empty or first row?
        // rdr.headers() returns the first row if has_headers(true), but if has_headers(false), it returns empty?
        // No, if has_headers(false), the first record is data.
        // We'll read all records first.
        // Actually, let's just read records.
        // If we don't have headers, we'll generate them after reading the first record.
        headers = vec![]; // Placeholder
    }

    let rows: Vec<StringRecord> = rdr.records()
        .collect::<Result<Vec<_>, _>>()?;

    if !has_headers {
        if rows.is_empty() {
            return Ok((vec![], vec![], AHashMap::new()));
        }
        let col_count = rows[0].len();
        let generated_headers: Vec<String> = (0..col_count)
            .map(|i| format!("Column{}", i + 1))
            .collect();
        
        for (i, h) in generated_headers.iter().enumerate() {
            header_map.insert(h.clone(), i);
        }
        return Ok((generated_headers, rows, header_map));
    }

    Ok((headers, rows, header_map))
}

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
    on_progress(0.0, "Parsing source CSV...");
    let (source_headers, source_rows, source_header_map) = parse_csv_internal(source_csv, has_headers)?;

    on_progress(10.0, "Parsing target CSV...");
    let (target_headers, target_rows, target_header_map) = parse_csv_internal(target_csv, has_headers)?;

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
                    // Handle case where target might not have the same column if headers differ (though usually they match)
                    // Assuming schemas match for PK mode or we only compare common columns?
                    // The original code iterated source_headers and looked up in target_row.
                    // We need to find the index in target for this header.
                    let target_idx = match target_header_map.get(header) {
                        Some(idx) => idx,
                        None => continue, // Skip if column missing in target
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
                        let diffs = diff_text_internal(source_val_raw, target_val_raw, case_sensitive);

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
    on_progress(0.0, "Parsing source CSV...");
    let (source_headers, source_rows, source_header_map) = parse_csv_internal(source_csv, has_headers)?;

    on_progress(10.0, "Parsing target CSV...");
    let (target_headers_orig, target_rows_orig, target_header_map_orig) = parse_csv_internal(target_csv, has_headers)?;

    // Align target rows to source headers if headers differ but counts match
    // For StringRecord, we can't easily "remap" without creating new records.
    // But we can just use a different header map if the columns are in different order?
    // The original code remapped rows to match source keys.
    // If we assume column order matches when headers are different but count is same (data-as-headers case),
    // we can just use source_headers and source_header_map for target if we treat them as positionally equivalent.
    
    let (target_headers, target_rows, target_header_map) = if source_headers != target_headers_orig && source_headers.len() == target_headers_orig.len() {
        // Assume positional mapping
        (source_headers.clone(), target_rows_orig, source_header_map.clone())
    } else {
        (target_headers_orig, target_rows_orig, target_header_map_orig)
    };

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    on_progress(20.0, "Indexing target rows...");
    
    let mut unmatched_target_indices: AHashSet<usize> = (0..target_rows.len()).collect();
    
    // Build lookup for exact matches: Fingerprint -> Vec<TargetIndex>
    let mut target_fingerprint_lookup: AHashMap<String, Vec<usize>> = AHashMap::new();
    
    // Build inverted index for similarity search: (ColumnIndex, Value) -> Vec<TargetIndex>
    let mut inverted_index: AHashMap<(usize, String), Vec<usize>> = AHashMap::new();

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

        // Populate inverted index
        for (col_idx, header) in source_headers.iter().enumerate() {
            if excluded_columns.contains(header) {
                continue;
            }
            // We need to find which column index in target corresponds to this header
            if let Some(&target_col_idx) = target_header_map.get(header) {
                if let Some(val) = row.get(target_col_idx) {
                    let norm_val = normalize_value(val, case_sensitive, ignore_whitespace);
                    inverted_index.entry((col_idx, norm_val)).or_default().push(idx);
                }
            }
        }
    }
    
    let mut row_counter = 1;
    let total_rows = source_rows.len();

    for (i, source_row) in source_rows.iter().enumerate() {
        if i % 100 == 0 {
            let progress = 20.0 + (i as f64 / total_rows as f64) * 70.0;
            on_progress(progress, "Comparing rows...");
        }

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
                        key: format!("Row {}", row_counter),
                        row: record_to_hashmap(source_row, &source_headers),
                    });
                    unmatched_target_indices.remove(&target_idx);
                    matched_exact = true;
                    break;
                }
            }
        }

        if !matched_exact {
            let mut candidate_scores: AHashMap<usize, usize> = AHashMap::new();
            
            for (col_idx, header) in source_headers.iter().enumerate() {
                if excluded_columns.contains(header) {
                    continue;
                }
                
                if let Some(&source_col_idx) = source_header_map.get(header) {
                    let source_val = normalize_value(
                        source_row.get(source_col_idx).unwrap_or(""),
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
            }

            let mut best_match_idx: Option<usize> = None;
            let mut best_score_count = 0;
            
            for (&idx, &score) in &candidate_scores {
                if score > best_score_count {
                    best_score_count = score;
                    best_match_idx = Some(idx);
                }
            }

            let mut final_score = 0.0;
            if let Some(_) = best_match_idx {
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
                            let diffs = diff_text_internal(source_val_raw, target_val_raw, case_sensitive);

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
                    removed.push(RemovedRow {
                        key: format!("Removed {}", removed.len() + 1),
                        source_row: record_to_hashmap(source_row, &source_headers),
                    });
                }
            } else {
                 removed.push(RemovedRow {
                    key: format!("Removed {}", removed.len() + 1),
                    source_row: record_to_hashmap(source_row, &source_headers),
                });
            }
        }
        row_counter += 1;
    }

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
        source: DatasetMetadata {
            headers: source_headers.clone(),
            rows: source_rows.iter().map(|r| record_to_hashmap(r, &source_headers)).collect(),
        },
        target: DatasetMetadata {
            headers: target_headers.clone(),
            rows: target_rows.iter().map(|r| record_to_hashmap(r, &target_headers)).collect(),
        },
        key_columns: vec![],
        excluded_columns: excluded_columns,
        mode: "content-match".to_string(),
    })
}

pub fn diff_text_internal(old: &str, new: &str, case_sensitive: bool) -> Vec<DiffChange> {
    let old_lower;
    let new_lower;
    
    let diff = if case_sensitive {
        TextDiff::from_words(old, new)
    } else {
        old_lower = old.to_lowercase();
        new_lower = new.to_lowercase();
        TextDiff::from_words(&old_lower, &new_lower)
    };

    let mut changes = Vec::new();

    for change in diff.iter_all_changes() {
        let (added, removed) = match change.tag() {
            ChangeTag::Delete => (false, true),
            ChangeTag::Insert => (true, false),
            ChangeTag::Equal => (false, false),
        };
        
        changes.push(DiffChange {
            added,
            removed,
            value: change.value().to_string(),
        });
    }
    changes
}
