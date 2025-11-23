pub use crate::parse::parse_csv_internal;
pub use crate::primary_key::diff_csv_primary_key_internal;
pub use crate::content_match::diff_csv_internal;

use csv::StringRecord;
use ahash::{AHashMap, AHashSet};
use similar::{ChangeTag, TextDiff};
use crate::types::*;
use crate::utils::*;

// Parsing and diff functions moved to dedicated modules: parse.rs, primary_key.rs, content_match.rs

// Primary key diff function moved to `primary_key.rs` and re-exported above

// Content-match diff function moved to `content_match.rs` and re-exported above

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

        // Build fingerprint lookup for exact matches only
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
        }

        self.unmatched_target_indices = Some(unmatched_target_indices);
        self.target_fingerprint_lookup = Some(target_fingerprint_lookup);
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

        let mut added = Vec::new();
        let mut removed = Vec::new();
        let mut modified = Vec::new();
        let mut unchanged = Vec::new();

        let chunk_end = (chunk_start + chunk_size).min(self.source_rows.len());
        let mut row_counter = chunk_start + 1;

        for (i, source_row) in self.source_rows.iter().enumerate().skip(chunk_start).take(chunk_end - chunk_start) {
             if (i - chunk_start) % 50 == 0 {
                let chunk_progress = (i - chunk_start) as f64 / (chunk_end - chunk_start) as f64;
                on_progress(chunk_progress * 100.0, &format!("Fuzzy matching row {} of chunk...", i - chunk_start));
            }

            // Try exact match via fingerprint first
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

            // If no exact match, use strsim-based fuzzy matching
            if !matched_exact {
                let mut best_match_idx: Option<usize> = None;
                let mut best_similarity_score = 0.0;

                // Calculate similarity with all unmatched target rows
                for &target_idx in unmatched_target_indices.iter() {
                    let target_row = &self.target_rows[target_idx];
                    
                    let similarity = calculate_row_similarity(
                        source_row,
                        target_row,
                        &self.source_headers,
                        &self.source_header_map,
                        &self.target_header_map,
                        &self.excluded_columns,
                    );

                    if similarity > best_similarity_score {
                        best_similarity_score = similarity;
                        best_match_idx = Some(target_idx);
                    }
                }

                // Threshold for considering a match (50% similarity)
                if let Some(idx) = best_match_idx {
                    if best_similarity_score > 0.5 {
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
