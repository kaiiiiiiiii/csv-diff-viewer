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
        
        // Collect all rows first
        let rows: Vec<StringRecord> = rdr.records().collect::<Result<Vec<_>, _>>()?;
        
        // Auto-detect if headers are actually data
        if !headers.is_empty() && !rows.is_empty() {
            let first_row = &rows[0];
            
            // Check if "headers" look like data (numeric values)
            let header_looks_like_data = headers.len() == first_row.len() && 
                headers.iter().any(|h| {
                    let trimmed = h.trim();
                    // Consider it data if it's purely numeric or looks like an ID
                    trimmed.chars().all(|c| c.is_ascii_digit()) || 
                    (trimmed.len() <= 6 && trimmed.chars().all(|c| c.is_ascii_digit()))
                });
            
            if header_looks_like_data {
                // Re-parse as CSV without headers
                let mut rdr_no_headers = ReaderBuilder::new()
                    .has_headers(false)
                    .trim(csv::Trim::All)
                    .from_reader(csv_content.as_bytes());
                
                let auto_headers: Vec<String> = (0..first_row.len())
                    .map(|i| format!("Column{}", i + 1))
                    .collect();
                
                let auto_rows = rdr_no_headers.records()
                    .collect::<Result<Vec<_>, _>>()?;
                
                for (i, h) in auto_headers.iter().enumerate() {
                    header_map.insert(h.clone(), i);
                }
                
                return Ok((auto_headers, auto_rows, header_map));
            }
        }
        
        // Normal case - use provided headers
        for (i, h) in headers.iter().enumerate() {
            header_map.insert(h.clone(), i);
        }
        
        return Ok((headers, rows, header_map));
    } else {
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

    let (target_headers, target_rows, target_header_map) = if source_headers != target_headers_orig && source_headers.len() == target_headers_orig.len() {
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
    
    let mut target_fingerprint_lookup: AHashMap<String, Vec<usize>> = AHashMap::new();
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

        for (col_idx, header) in source_headers.iter().enumerate() {
            if excluded_columns.contains(header) {
                continue;
            }
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
    
    let mut candidate_scores: AHashMap<usize, usize> = AHashMap::new();
    let mut row_tokens: Vec<(usize, usize, String)> = Vec::new();

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
            candidate_scores.clear();
            row_tokens.clear();
            
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

                    if let Some(target_indices) = inverted_index.get(&(col_idx, source_val.clone())) {
                        row_tokens.push((target_indices.len(), col_idx, source_val));
                    }
                }
            }

            row_tokens.sort_by(|a, b| a.0.cmp(&b.0));

            let mut budget = 2000;
            
            for (count, col_idx, val) in &row_tokens {
                if *count == 0 { continue; }
                if budget == 0 { break; }
                
                if *count > budget && !candidate_scores.is_empty() {
                    break;
                }
                
                if *count > 10000 {
                    break;
                }

                if let Some(target_indices) = inverted_index.get(&(*col_idx, val.clone())) {
                    for &target_idx in target_indices {
                        if unmatched_target_indices.contains(&target_idx) {
                            *candidate_scores.entry(target_idx).or_default() += 1;
                        }
                    }
                    budget = budget.saturating_sub(*count);
                }
            }

            let mut top_candidates: Vec<(usize, usize)> = candidate_scores.iter().map(|(&k, &v)| (k, v)).collect();
            top_candidates.sort_by(|a, b| b.1.cmp(&a.1));
            if top_candidates.len() > 10 {
                top_candidates.truncate(10);
            }

            let mut best_match_idx: Option<usize> = None;
            let mut best_real_score = 0.0;

            for (cand_idx, _) in top_candidates {
                 let target_row = &target_rows[cand_idx];
                 
                 // Use strsim-based similarity calculation for more accurate matching
                 let score = calculate_row_similarity(
                     source_row,
                     target_row,
                     &source_headers,
                     &source_header_map,
                     &target_header_map,
                     &excluded_columns,
                 );

                 if score > best_real_score {
                     best_real_score = score;
                     best_match_idx = Some(cand_idx);
                 }
            }

            if let Some(idx) = best_match_idx {
                if best_real_score > 0.5 {
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

pub struct CsvDifferInternal {
    source_headers: Vec<String>,
    source_rows: Vec<StringRecord>,
    source_header_map: AHashMap<String, usize>,
    target_headers: Vec<String>,
    target_rows: Vec<StringRecord>,
    target_header_map: AHashMap<String, usize>,
    
    key_columns: Vec<String>,
    excluded_columns: Vec<String>,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    mode: String,

    // PK Mode State
    source_map: Option<AHashMap<String, usize>>,
    target_map: Option<AHashMap<String, usize>>,

    // Content Match Mode State
    unmatched_target_indices: Option<AHashSet<usize>>,
    target_fingerprint_lookup: Option<AHashMap<String, Vec<usize>>>,
    inverted_index: Option<AHashMap<(usize, String), Vec<usize>>>,
}

impl CsvDifferInternal {
    pub fn new(
        source_csv: &str,
        target_csv: &str,
        key_columns: Vec<String>,
        case_sensitive: bool,
        ignore_whitespace: bool,
        ignore_empty_vs_null: bool,
        excluded_columns: Vec<String>,
        has_headers: bool,
        mode: String,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        // Parse CSVs
        let (source_headers, source_rows, source_header_map) = parse_csv_internal(source_csv, has_headers)?;
        let (target_headers_orig, target_rows_orig, target_header_map_orig) = parse_csv_internal(target_csv, has_headers)?;

        // Align headers for Content Match if needed
        let (target_headers, target_rows, target_header_map) = if mode == "content-match" && source_headers != target_headers_orig && source_headers.len() == target_headers_orig.len() {
            (source_headers.clone(), target_rows_orig, source_header_map.clone())
        } else {
            (target_headers_orig, target_rows_orig, target_header_map_orig)
        };

        let mut differ = CsvDifferInternal {
            source_headers,
            source_rows,
            source_header_map,
            target_headers,
            target_rows,
            target_header_map,
            key_columns,
            excluded_columns,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            mode: mode.clone(),
            source_map: None,
            target_map: None,
            unmatched_target_indices: None,
            target_fingerprint_lookup: None,
            inverted_index: None,
        };

        if mode == "primary-key" {
            differ.init_primary_key()?;
        } else {
            differ.init_content_match()?;
        }

        Ok(differ)
    }

    fn init_primary_key(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // Validation
        for key in &self.key_columns {
            if !self.source_header_map.contains_key(key) {
                 return Err(format!("Primary key column \"{}\" not found in source dataset.", key).into());
            }
            if !self.target_header_map.contains_key(key) {
                 return Err(format!("Primary key column \"{}\" not found in target dataset.", key).into());
            }
        }

        // Build maps
        let mut source_map = AHashMap::new();
        for (i, row) in self.source_rows.iter().enumerate() {
            let key = get_row_key(row, &self.source_header_map, &self.key_columns);
            if source_map.contains_key(&key) {
                 return Err(format!("Duplicate Primary Key found in source: \"{}\". Primary Keys must be unique.", key).into());
            }
            source_map.insert(key, i);
        }

        let mut target_map = AHashMap::new();
        for (i, row) in self.target_rows.iter().enumerate() {
            let key = get_row_key(row, &self.target_header_map, &self.key_columns);
            if target_map.contains_key(&key) {
                 return Err(format!("Duplicate Primary Key found in target: \"{}\". Primary Keys must be unique.", key).into());
            }
            target_map.insert(key, i);
        }

        self.source_map = Some(source_map);
        self.target_map = Some(target_map);
        Ok(())
    }

    fn init_content_match(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let unmatched_target_indices: AHashSet<usize> = (0..self.target_rows.len()).collect();
        let mut target_fingerprint_lookup: AHashMap<String, Vec<usize>> = AHashMap::new();
        let mut inverted_index: AHashMap<(usize, String), Vec<usize>> = AHashMap::new();

        for (idx, row) in self.target_rows.iter().enumerate() {
            let fp = get_row_fingerprint(
                row, 
                &self.source_headers, 
                &self.target_header_map,
                self.case_sensitive, 
                self.ignore_whitespace,
                self.ignore_empty_vs_null,
                &self.excluded_columns
            );
            target_fingerprint_lookup.entry(fp).or_default().push(idx);

            for (col_idx, header) in self.source_headers.iter().enumerate() {
                if self.excluded_columns.contains(header) {
                    continue;
                }
                if let Some(&target_col_idx) = self.target_header_map.get(header) {
                    if let Some(val) = row.get(target_col_idx) {
                        let norm_val = normalize_value(val, self.case_sensitive, self.ignore_whitespace);
                        inverted_index.entry((col_idx, norm_val)).or_default().push(idx);
                    }
                }
            }
        }

        self.unmatched_target_indices = Some(unmatched_target_indices);
        self.target_fingerprint_lookup = Some(target_fingerprint_lookup);
        self.inverted_index = Some(inverted_index);
        Ok(())
    }

    pub fn diff_chunk<F>(&mut self, chunk_start: usize, chunk_size: usize, on_progress: F) -> Result<DiffResult, Box<dyn std::error::Error>>
    where F: FnMut(f64, &str) {
        if self.mode == "primary-key" {
            self.diff_primary_key_chunk(chunk_start, chunk_size, on_progress)
        } else {
            self.diff_content_match_chunk(chunk_start, chunk_size, on_progress)
        }
    }

    fn diff_primary_key_chunk<F>(&self, chunk_start: usize, chunk_size: usize, mut on_progress: F) -> Result<DiffResult, Box<dyn std::error::Error>>
    where F: FnMut(f64, &str) {
        let source_map = self.source_map.as_ref().unwrap();
        let target_map = self.target_map.as_ref().unwrap();

        let mut added = Vec::new();
        let mut removed = Vec::new();
        let mut modified = Vec::new();
        let mut unchanged = Vec::new();

        // Iterate target rows by index to ensure stability
        let chunk_end = (chunk_start + chunk_size).min(self.target_rows.len());
        
        for i in chunk_start..chunk_end {
            if (i - chunk_start) % 100 == 0 {
                let chunk_progress = (i - chunk_start) as f64 / (chunk_end - chunk_start) as f64;
                on_progress(chunk_progress * 100.0, &format!("Processing row {} of chunk...", i - chunk_start));
            }

            let target_row = &self.target_rows[i];
            let key = get_row_key(target_row, &self.target_header_map, &self.key_columns);

            match source_map.get(&key) {
                None => {
                    added.push(AddedRow {
                        key: key.clone(),
                        target_row: record_to_hashmap(target_row, &self.target_headers),
                    });
                }
                Some(&source_row_idx) => {
                    let source_row = &self.source_rows[source_row_idx];
                    let mut differences = Vec::new();
                    
                    for header in &self.source_headers {
                        if self.excluded_columns.contains(header) { continue; }
                        
                        let source_idx = self.source_header_map.get(header).unwrap();
                        let target_idx = match self.target_header_map.get(header) {
                            Some(idx) => idx,
                            None => continue,
                        };

                        let source_val_raw = source_row.get(*source_idx).unwrap_or("");
                        let target_val_raw = target_row.get(*target_idx).unwrap_or("");

                        let source_val = normalize_value_with_empty_vs_null(
                            source_val_raw,
                            self.case_sensitive,
                            self.ignore_whitespace,
                            self.ignore_empty_vs_null
                        );
                        let target_val = normalize_value_with_empty_vs_null(
                            target_val_raw,
                            self.case_sensitive,
                            self.ignore_whitespace,
                            self.ignore_empty_vs_null
                        );

                        if source_val != target_val {
                            let diffs = diff_text_internal(source_val_raw, target_val_raw, self.case_sensitive);
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
                            source_row: record_to_hashmap(source_row, &self.source_headers),
                            target_row: record_to_hashmap(target_row, &self.target_headers),
                            differences,
                        });
                    } else {
                        unchanged.push(UnchangedRow {
                            key: key.clone(),
                            row: record_to_hashmap(source_row, &self.source_headers),
                        });
                    }
                }
            }
        }

        // On the last chunk (of target rows), find removed rows
        if chunk_end >= self.target_rows.len() {
             for (key, &row_idx) in source_map {
                if !target_map.contains_key(key) {
                    removed.push(RemovedRow {
                        key: key.clone(),
                        source_row: record_to_hashmap(&self.source_rows[row_idx], &self.source_headers),
                    });
                }
            }
        }

        Ok(DiffResult {
            added,
            removed,
            modified,
            unchanged,
            source: DatasetMetadata { headers: self.source_headers.clone(), rows: vec![] },
            target: DatasetMetadata { headers: self.target_headers.clone(), rows: vec![] },
            key_columns: self.key_columns.clone(),
            excluded_columns: self.excluded_columns.clone(),
            mode: "primary-key".to_string(),
        })
    }

    fn diff_content_match_chunk<F>(&mut self, chunk_start: usize, chunk_size: usize, mut on_progress: F) -> Result<DiffResult, Box<dyn std::error::Error>>
    where F: FnMut(f64, &str) {
        let unmatched_target_indices = self.unmatched_target_indices.as_mut().unwrap();
        let target_fingerprint_lookup = self.target_fingerprint_lookup.as_mut().unwrap();
        let inverted_index = self.inverted_index.as_ref().unwrap();

        let mut added = Vec::new();
        let mut removed = Vec::new();
        let mut modified = Vec::new();
        let mut unchanged = Vec::new();

        let chunk_end = (chunk_start + chunk_size).min(self.source_rows.len());
        let mut row_counter = chunk_start + 1;

        let mut candidate_scores: AHashMap<usize, usize> = AHashMap::new();
        let mut row_tokens: Vec<(usize, usize, String)> = Vec::new();

        for (i, source_row) in self.source_rows.iter().enumerate().skip(chunk_start).take(chunk_end - chunk_start) {
             if (i - chunk_start) % 50 == 0 {
                let chunk_progress = (i - chunk_start) as f64 / (chunk_end - chunk_start) as f64;
                on_progress(chunk_progress * 100.0, &format!("Processing row {} of chunk...", i - chunk_start));
            }

            let source_fingerprint = get_row_fingerprint(
                source_row, 
                &self.source_headers, 
                &self.source_header_map,
                self.case_sensitive, 
                self.ignore_whitespace,
                self.ignore_empty_vs_null,
                &self.excluded_columns
            );

            let mut matched_exact = false;

            if let Some(indices) = target_fingerprint_lookup.get_mut(&source_fingerprint) {
                while let Some(target_idx) = indices.pop() {
                    if unmatched_target_indices.contains(&target_idx) {
                        unchanged.push(UnchangedRow {
                            key: format!("Row {}", row_counter),
                            row: record_to_hashmap(source_row, &self.source_headers),
                        });
                        unmatched_target_indices.remove(&target_idx);
                        matched_exact = true;
                        break;
                    }
                }
            }

            if !matched_exact {
                candidate_scores.clear();
                row_tokens.clear();
                
                for (col_idx, header) in self.source_headers.iter().enumerate() {
                    if self.excluded_columns.contains(header) { continue; }
                    
                    if let Some(&source_col_idx) = self.source_header_map.get(header) {
                        let source_val = normalize_value(
                            source_row.get(source_col_idx).unwrap_or(""),
                            self.case_sensitive,
                            self.ignore_whitespace
                        );

                        if let Some(target_indices) = inverted_index.get(&(col_idx, source_val.clone())) {
                            row_tokens.push((target_indices.len(), col_idx, source_val));
                        }
                    }
                }

                row_tokens.sort_by(|a, b| a.0.cmp(&b.0));

                let mut budget = 2000;
                for (count, col_idx, val) in &row_tokens {
                    if *count == 0 { continue; }
                    if budget == 0 { break; }
                    if *count > budget && !candidate_scores.is_empty() { break; }
                    if *count > 10000 { break; }

                    if let Some(target_indices) = inverted_index.get(&(*col_idx, val.clone())) {
                        for &target_idx in target_indices {
                            if unmatched_target_indices.contains(&target_idx) {
                                *candidate_scores.entry(target_idx).or_default() += 1;
                            }
                        }
                        budget = budget.saturating_sub(*count);
                    }
                }

                let mut top_candidates: Vec<(usize, usize)> = candidate_scores.iter().map(|(&k, &v)| (k, v)).collect();
                top_candidates.sort_by(|a, b| b.1.cmp(&a.1));
                if top_candidates.len() > 10 { top_candidates.truncate(10); }

                let mut best_match_idx: Option<usize> = None;
                let mut best_real_score = 0.0;

                for (cand_idx, _) in top_candidates {
                    let target_row = &self.target_rows[cand_idx];
                    let mut match_count = 0;
                    let mut total_compared = 0;
                    
                    for header in &self.source_headers {
                        if self.excluded_columns.contains(header) { continue; }
                        let source_idx = self.source_header_map.get(header).unwrap();
                        let target_idx = match self.target_header_map.get(header) {
                            Some(idx) => idx,
                            None => continue,
                        };
                        total_compared += 1;
                        let source_val = normalize_value(
                            source_row.get(*source_idx).unwrap_or(""),
                            self.case_sensitive,
                            self.ignore_whitespace
                        );
                        let target_val = normalize_value(
                            target_row.get(*target_idx).unwrap_or(""),
                            self.case_sensitive,
                            self.ignore_whitespace
                        );
                        if source_val == target_val { match_count += 1; }
                    }
                    
                    let score = if total_compared > 0 { match_count as f64 / total_compared as f64 } else { 0.0 };
                    if score > best_real_score {
                        best_real_score = score;
                        best_match_idx = Some(cand_idx);
                    }
                }

                if let Some(idx) = best_match_idx {
                    if best_real_score > 0.5 {
                        let target_row = &self.target_rows[idx];
                        let mut differences = Vec::new();
                        for header in &self.source_headers {
                            if self.excluded_columns.contains(header) { continue; }
                            let source_idx = self.source_header_map.get(header).unwrap();
                            let target_idx = match self.target_header_map.get(header) {
                                Some(idx) => idx,
                                None => continue,
                            };
                            let source_val_raw = source_row.get(*source_idx).unwrap_or("");
                            let target_val_raw = target_row.get(*target_idx).unwrap_or("");
                            let source_val = normalize_value_with_empty_vs_null(
                                source_val_raw,
                                self.case_sensitive,
                                self.ignore_whitespace,
                                self.ignore_empty_vs_null
                            );
                            let target_val = normalize_value_with_empty_vs_null(
                                target_val_raw,
                                self.case_sensitive,
                                self.ignore_whitespace,
                                self.ignore_empty_vs_null
                            );
                            if source_val != target_val {
                                let diffs = diff_text_internal(source_val_raw, target_val_raw, self.case_sensitive);
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
                            source_row: record_to_hashmap(source_row, &self.source_headers),
                            target_row: record_to_hashmap(target_row, &self.target_headers),
                            differences,
                        });
                        unmatched_target_indices.remove(&idx);
                    } else {
                        removed.push(RemovedRow {
                            key: format!("Removed {}", removed.len() + 1),
                            source_row: record_to_hashmap(source_row, &self.source_headers),
                        });
                    }
                } else {
                    removed.push(RemovedRow {
                        key: format!("Removed {}", removed.len() + 1),
                        source_row: record_to_hashmap(source_row, &self.source_headers),
                    });
                }
            }
            row_counter += 1;
        }

        // On the last chunk (of source rows), find added rows
        if chunk_end >= self.source_rows.len() {
            let mut added_index = 1;
            let mut remaining_indices: Vec<_> = unmatched_target_indices.iter().cloned().collect();
            remaining_indices.sort();

            for idx in remaining_indices {
                let row = &self.target_rows[idx];
                added.push(AddedRow {
                    key: format!("Added {}", added_index),
                    target_row: record_to_hashmap(row, &self.target_headers),
                });
                added_index += 1;
            }
        }

        Ok(DiffResult {
            added,
            removed,
            modified,
            unchanged,
            source: DatasetMetadata { headers: self.source_headers.clone(), rows: vec![] },
            target: DatasetMetadata { headers: self.target_headers.clone(), rows: vec![] },
            key_columns: vec![],
            excluded_columns: self.excluded_columns.clone(),
            mode: "content-match".to_string(),
        })
    }
}
