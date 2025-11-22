/// Streaming CSV parsing and diff computation
/// Enables progressive processing of large files without loading entire datasets into memory
use csv::{ReaderBuilder, StringRecord};
use ahash::AHashMap;
use crate::types::{DiffResult, AddedRow, RemovedRow, ModifiedRow, UnchangedRow};
use std::collections::VecDeque;

/// Streaming CSV reader that yields chunks of records
pub struct StreamingCsvReader {
    headers: Vec<String>,
    header_map: AHashMap<String, usize>,
    buffer: VecDeque<StringRecord>,
    chunk_size: usize,
}

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
        
        for _ in 0..self.chunk_size {
            match reader.records().next() {
                Some(Ok(record)) => chunk.push(record),
                Some(Err(e)) => return Err(e.into()),
                None => break,
            }
        }
        
        Ok(chunk)
    }
}

/// Streaming diff result that can be computed incrementally
pub struct StreamingDiffResult {
    pub added: Vec<AddedRow>,
    pub removed: Vec<RemovedRow>,
    pub modified: Vec<ModifiedRow>,
    pub unchanged: Vec<UnchangedRow>,
    pub total_processed: usize,
    pub total_source_rows: usize,
    pub total_target_rows: usize,
}

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
        use std::collections::HashMap;
        
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
