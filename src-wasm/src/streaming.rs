/// Streaming CSV parsing and diff computation
/// Enables progressive processing of large files without loading entire datasets into memory
use csv::{ReaderBuilder, StringRecord};
use ahash::AHashMap;
use crate::types::{DiffResult, AddedRow, RemovedRow, ModifiedRow, UnchangedRow};
use std::collections::VecDeque;

/// Streaming CSV reader that yields chunks of records
#[allow(dead_code)]
pub struct StreamingCsvReader {
    headers: Vec<String>,
    header_map: AHashMap<String, usize>,
    buffer: VecDeque<StringRecord>,
    chunk_size: usize,
}

#[allow(dead_code)]
impl StreamingCsvReader {
    /// Create a new streaming reader with specified chunk size
    pub fn new(
        csv_content: &str,
        has_headers: bool,
        chunk_size: usize,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let mut rdr = ReaderBuilder::new()
            .has_headers(has_headers)
            .trim(csv::Trim::All)
            .from_reader(csv_content.as_bytes());
        
        let headers: Vec<String>;
        let mut header_map = AHashMap::new();
        
        if has_headers {
            let header_record = rdr.headers()?;
            headers = header_record.iter().map(|s| s.to_string()).collect();
        } else {
            // Generate headers from first row
            let first_row = rdr.records().next();
            let col_count = first_row
                .as_ref()
                .and_then(|r| r.as_ref().ok())
                .map(|r| r.len())
                .unwrap_or(0);
            headers = (0..col_count)
                .map(|i| format!("Column{}", i + 1))
                .collect();
        }
        
        for (i, h) in headers.iter().enumerate() {
            header_map.insert(h.clone(), i);
        }
        
        Ok(Self {
            headers,
            header_map,
            buffer: VecDeque::new(),
            chunk_size,
        })
    }
    
    /// Get the headers
    pub fn headers(&self) -> &[String] {
        &self.headers
    }
    
    /// Get the header map
    pub fn header_map(&self) -> &AHashMap<String, usize> {
        &self.header_map
    }
    
    /// Read next chunk of records
    pub fn next_chunk(&mut self, reader: &mut csv::Reader<&[u8]>) -> Result<Vec<StringRecord>, Box<dyn std::error::Error>> {
        let mut chunk = Vec::with_capacity(self.chunk_size);
        let start_row = chunk.len();
        
        for i in 0..self.chunk_size {
            match reader.records().next() {
                Some(Ok(record)) => chunk.push(record),
                Some(Err(e)) => {
                    let row_num = start_row + i + 1;
                    return Err(format!("CSV parsing error at row {}: {}", row_num, e).into());
                },
                None => break,
            }
        }
        
        Ok(chunk)
    }
}

/// Streaming diff result that can be computed incrementally
#[allow(dead_code)]
pub struct StreamingDiffResult {
    pub added: Vec<AddedRow>,
    pub removed: Vec<RemovedRow>,
    pub modified: Vec<ModifiedRow>,
    pub unchanged: Vec<UnchangedRow>,
    pub total_processed: usize,
    pub total_source_rows: usize,
    pub total_target_rows: usize,
}

#[allow(dead_code)]
impl StreamingDiffResult {
    pub fn new(total_source: usize, total_target: usize) -> Self {
        Self {
            added: Vec::new(),
            removed: Vec::new(),
            modified: Vec::new(),
            unchanged: Vec::new(),
            total_processed: 0,
            total_source_rows: total_source,
            total_target_rows: total_target,
        }
    }
    
    /// Merge another chunk result into this result
    pub fn merge(&mut self, other: StreamingDiffResult) {
        self.added.extend(other.added);
        self.removed.extend(other.removed);
        self.modified.extend(other.modified);
        self.unchanged.extend(other.unchanged);
        self.total_processed += other.total_processed;
    }
    
    /// Convert to final DiffResult
    pub fn to_diff_result(self, source_headers: Vec<String>, target_headers: Vec<String>, key_columns: Vec<String>, excluded_columns: Vec<String>, mode: String) -> DiffResult {
        use crate::types::DatasetMetadata;

        
        DiffResult {
            added: self.added,
            removed: self.removed,
            modified: self.modified,
            unchanged: self.unchanged,
            source: DatasetMetadata {
                headers: source_headers,
                rows: Vec::new(), // Streaming doesn't store full rows
            },
            target: DatasetMetadata {
                headers: target_headers,
                rows: Vec::new(),
            },
            key_columns,
            excluded_columns,
            mode,
        }
    }
    
    /// Get progress percentage
    pub fn progress(&self) -> f64 {
        if self.total_target_rows == 0 {
            100.0
        } else {
            (self.total_processed as f64 / self.total_target_rows as f64) * 100.0
        }
    }
}

/// Configuration for streaming diff operations
#[derive(Clone)]
#[allow(dead_code)]
pub struct StreamingConfig {
    pub chunk_size: usize,
    pub enable_progress_updates: bool,
    pub progress_update_interval: usize, // Update every N chunks
}

impl Default for StreamingConfig {
    fn default() -> Self {
        Self {
            chunk_size: 5000,
            enable_progress_updates: true,
            progress_update_interval: 10,
        }
    }
}

#[allow(dead_code)]
impl StreamingConfig {
    /// Create a new streaming config with custom chunk size
    pub fn new(chunk_size: usize) -> Self {
        Self {
            chunk_size,
            ..Default::default()
        }
    }
    
    /// Builder pattern for configuration
    pub fn with_progress_interval(mut self, interval: usize) -> Self {
        self.progress_update_interval = interval;
        self
    }
}

/// Chunked diff for primary key mode
#[allow(dead_code)]
pub fn diff_chunk_primary_key<F>(
    source_csv: &str,
    target_csv: &str,
    key_columns: &[String],
    _case_sensitive: bool,
    _ignore_whitespace: bool,
    _ignore_empty_vs_null: bool,
    _excluded_columns: &[String],
    has_headers: bool,
    chunk_start: usize,
    chunk_size: usize,
    _config: &StreamingConfig,
    mut on_progress: F,
) -> Result<StreamingDiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    // Parse only the required chunks
    let (source_headers, source_rows, _) = crate::parse::parse_csv_streaming(
        source_csv, 
        has_headers, 
        chunk_size,
        |percent, message| {
            on_progress(percent * 0.3, &format!("Parsing source chunk: {}", message));
        }
    )?;
    
    let (target_headers, target_rows, _) = crate::parse::parse_csv_streaming(
        target_csv, 
        has_headers, 
        chunk_size,
        |percent, message| {
            on_progress(30.0 + percent * 0.3, &format!("Parsing target chunk: {}", message));
        }
    )?;
    
    on_progress(60.0, "Building hash maps for chunk...");
    
    // Build header maps for this chunk
    let mut source_header_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, h) in source_headers.iter().enumerate() {
        source_header_map.insert(h.clone(), i);
    }
    
    let mut target_header_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, h) in target_headers.iter().enumerate() {
        target_header_map.insert(h.clone(), i);
    }
    
    // Build hash maps for this chunk only
    let mut source_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, row) in source_rows.iter().enumerate() {
        let key = crate::utils::get_row_key(row, &source_header_map, &key_columns);
        source_map.insert(key, i);
    }
    
    let mut target_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, row) in target_rows.iter().enumerate() {
        let key = crate::utils::get_row_key(row, &target_header_map, &key_columns);
        target_map.insert(key, i);
    }
    
    on_progress(80.0, "Comparing chunk...");
    
    let mut result = StreamingDiffResult::new(source_rows.len(), target_rows.len());
    
    // Process chunk
    for (key, &source_idx) in &source_map {
        if let Some(&target_idx) = target_map.get(key) {
            let source_row = &source_rows[source_idx];
            let target_row = &target_rows[target_idx];
            
            // Simple field-by-field comparison for now
            let mut is_equal = true;
            for h in &source_headers {
                if let Some(&source_idx) = source_header_map.get(h) {
                    if let Some(&target_idx) = target_header_map.get(h) {
                        let source_val = source_row.get(source_idx).unwrap_or("");
                        let target_val = target_row.get(target_idx).unwrap_or("");
                        
                        if source_val != target_val {
                            is_equal = false;
                            break;
                        }
                    }
                }
            }
            
            if is_equal {
                result.unchanged.push(UnchangedRow {
                    key: format!("row_{}", chunk_start + source_idx),
                    row: crate::utils::record_to_hashmap(source_row, &source_headers),
                });
            } else {
                result.modified.push(ModifiedRow {
                    key: format!("row_{}", chunk_start + source_idx),
                    source_row: crate::utils::record_to_hashmap(source_row, &source_headers),
                    target_row: crate::utils::record_to_hashmap(target_row, &target_headers),
                    differences: vec![],
                });
            }
        } else {
            result.removed.push(RemovedRow {
                key: format!("row_{}", chunk_start + source_idx),
                source_row: crate::utils::record_to_hashmap(&source_rows[source_idx], &source_headers),
            });
        }
    }
    
    for (key, &target_idx) in &target_map {
        if !source_map.contains_key(key) {
            result.added.push(AddedRow {
                key: format!("row_{}", chunk_start + target_idx),
                target_row: crate::utils::record_to_hashmap(&target_rows[target_idx], &target_headers),
            });
        }
    }
    
    result.total_processed = chunk_start + chunk_size.min(source_rows.len());
    on_progress(100.0, "Chunk processing complete");
    
    Ok(result)
}

/// Chunked diff for content match mode
#[allow(dead_code)]
pub fn diff_chunk_content_match<F>(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns: &[String],
    has_headers: bool,
    chunk_start: usize,
    chunk_size: usize,
    _config: &StreamingConfig,
    mut on_progress: F,
) -> Result<StreamingDiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    // Parse only the required chunks
    let (source_headers, source_rows, _) = crate::parse::parse_csv_streaming(
        source_csv, 
        has_headers, 
        chunk_size,
        |percent, message| {
            on_progress(percent * 0.3, &format!("Parsing source chunk: {}", message));
        }
    )?;
    
    let (target_headers, target_rows, _) = crate::parse::parse_csv_streaming(
        target_csv, 
        has_headers, 
        chunk_size,
        |percent, message| {
            on_progress(30.0 + percent * 0.3, &format!("Parsing target chunk: {}", message));
        }
    )?;
    
    on_progress(60.0, "Building fingerprint indexes for chunk...");
    
    // Use hash-based fingerprinting for faster comparison
    let excluded_set: ahash::AHashSet<_> = excluded_columns.iter().cloned().collect();
    
    // Build header map
    let mut target_header_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, h) in target_headers.iter().enumerate() {
        target_header_map.insert(h.clone(), i);
    }
    
    // Build fingerprint lookup for target
    let mut target_fingerprint_lookup: ahash::AHashMap<u64, Vec<usize>> = ahash::AHashMap::new();
    for (idx, row) in target_rows.iter().enumerate() {
        let fp = crate::utils::get_row_fingerprint_hash(
            row,
            &target_headers,
            &target_header_map,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            &excluded_set,
        );
        target_fingerprint_lookup.entry(fp).or_default().push(idx);
    }
    
    on_progress(80.0, "Comparing chunk...");
    
    let mut result = StreamingDiffResult::new(source_rows.len(), target_rows.len());
    let mut matched_target_indices: std::collections::HashSet<usize> = std::collections::HashSet::new();
    
    // Build source header map
    let mut source_header_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, h) in source_headers.iter().enumerate() {
        source_header_map.insert(h.clone(), i);
    }
    
    // Find exact matches first
    for (source_idx, source_row) in source_rows.iter().enumerate() {
        let source_fp = crate::utils::get_row_fingerprint_hash(
            source_row,
            &source_headers,
            &source_header_map,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            &excluded_set,
        );
        
        if let Some(target_indices) = target_fingerprint_lookup.get(&source_fp) {
            for &target_idx in target_indices {
                if !matched_target_indices.contains(&target_idx) {
                    matched_target_indices.insert(target_idx);
                    
                    // Simple field-by-field comparison for now
                    let mut is_equal = true;
                    for h in &source_headers {
                        if let Some(&source_idx) = source_header_map.get(h) {
                            if let Some(&target_idx) = target_header_map.get(h) {
                                let source_val = source_row.get(source_idx).unwrap_or("");
                                let target_val = target_rows[target_idx].get(target_idx).unwrap_or("");
                                
                                if source_val != target_val {
                                    is_equal = false;
                                    break;
                                }
                            }
                        }
                    }
                    
                    if is_equal {
                        result.unchanged.push(UnchangedRow {
                            key: format!("row_{}", chunk_start + source_idx),
                            row: crate::utils::record_to_hashmap(source_row, &source_headers),
                        });
                    } else {
                        result.modified.push(ModifiedRow {
                            key: format!("row_{}", chunk_start + source_idx),
                            source_row: crate::utils::record_to_hashmap(source_row, &source_headers),
                            target_row: crate::utils::record_to_hashmap(&target_rows[target_idx], &target_headers),
                            differences: vec![],
                        });
                    }
                    break;
                }
            }
        }
    }
    
    // Mark remaining unmatched rows
    for (source_idx, source_row) in source_rows.iter().enumerate() {
        let row_key = format!("row_{}", chunk_start + source_idx);
        if !result.unchanged.iter().any(|r| r.key == row_key) &&
           !result.modified.iter().any(|r| r.key == row_key) {
            result.removed.push(RemovedRow {
                key: row_key,
                source_row: crate::utils::record_to_hashmap(source_row, &source_headers),
            });
        }
    }
    
    for (target_idx, target_row) in target_rows.iter().enumerate() {
        if !matched_target_indices.contains(&target_idx) {
            result.added.push(AddedRow {
                key: format!("row_{}", chunk_start + target_idx),
                target_row: crate::utils::record_to_hashmap(target_row, &target_headers),
            });
        }
    }
    
    result.total_processed = chunk_start + chunk_size.min(source_rows.len());
    on_progress(100.0, "Chunk processing complete");
    
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_streaming_config() {
        let config = StreamingConfig::new(1000);
        assert_eq!(config.chunk_size, 1000);
        assert!(config.enable_progress_updates);
        
        let config2 = StreamingConfig::default().with_progress_interval(5);
        assert_eq!(config2.progress_update_interval, 5);
    }
    
    #[test]
    fn test_streaming_diff_result() {
        let mut result = StreamingDiffResult::new(100, 150);
        assert_eq!(result.total_source_rows, 100);
        assert_eq!(result.total_target_rows, 150);
        assert_eq!(result.total_processed, 0);
        
        result.total_processed = 75;
        let progress = result.progress();
        assert_eq!(progress, 50.0);
    }
}
