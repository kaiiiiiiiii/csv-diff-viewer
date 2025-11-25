use csv::ReaderBuilder;
use csv::StringRecord;
use ahash::AHashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

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

/// Streaming CSV parser that emits progress and processes in chunks
pub fn parse_csv_streaming<F>(
    csv_content: &str,
    has_headers: bool,
    chunk_size: usize,
    mut on_progress: F,
) -> Result<(Vec<String>, Vec<StringRecord>, AHashMap<String, usize>), Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    on_progress(0.0, "Initializing CSV reader...");
    
    let mut rdr = ReaderBuilder::new()
        .has_headers(has_headers)
        .trim(csv::Trim::All)
        .from_reader(csv_content.as_bytes());
    
    let headers: Vec<String>;
    let mut header_map: AHashMap<String, usize> = AHashMap::new();

    // First, get headers
    if has_headers {
        let header_record = rdr.headers()?;
        headers = header_record.iter().map(|s| s.to_string()).collect();
        
        // Auto-detect if headers are actually data
        let first_row_result = rdr.records().next();
        if let Some(Ok(first_row)) = first_row_result {
            let header_looks_like_data = headers.len() == first_row.len() && 
                headers.iter().any(|h| {
                    let trimmed = h.trim();
                    trimmed.chars().all(|c| c.is_ascii_digit()) || 
                    (trimmed.len() <= 6 && trimmed.chars().all(|c| c.is_ascii_digit()))
                });
            
            if header_looks_like_data {
                // Re-parse as CSV without headers
                return parse_csv_streaming_no_headers(csv_content, chunk_size, on_progress);
            }
        }
    } else {
        // Generate headers from first row
        let first_row_result = rdr.records().next();
        if let Some(Ok(first_row)) = first_row_result {
            let col_count = first_row.len();
            headers = (0..col_count)
                .map(|i| format!("Column{}", i + 1))
                .collect();
        } else {
            headers = vec![];
        }
    }

    for (i, h) in headers.iter().enumerate() {
        header_map.insert(h.clone(), i);
    }

    on_progress(5.0, "Reading CSV data in chunks...");
    
    // Count total rows for progress calculation
    let total_rows = csv_content.lines().count().saturating_sub(if has_headers { 1 } else { 0 });
    let rows_processed = AtomicUsize::new(0);
    
    // Process rows in chunks to avoid memory spikes
    let mut all_rows = Vec::with_capacity(total_rows.min(100000)); // Cap initial allocation
    let mut chunk = Vec::with_capacity(chunk_size);
    
    for record_result in rdr.records() {
        let record = record_result?;
        chunk.push(record);
        
        if chunk.len() >= chunk_size {
            all_rows.extend(chunk.drain(..));
            let processed = rows_processed.fetch_add(chunk_size, Ordering::Relaxed);
            let progress = (processed as f64 / total_rows as f64) * 90.0 + 5.0; // 5-95%
            on_progress(progress, &format!("Processed {} rows", processed + chunk_size));
        }
    }
    
    // Process remaining records
        if !chunk.is_empty() {
            let chunk_len = chunk.len();
            all_rows.extend(chunk);
            let processed = rows_processed.fetch_add(chunk_len, Ordering::Relaxed);
            let progress = (processed as f64 / total_rows as f64) * 90.0 + 5.0;
            on_progress(progress, &format!("Processed {} rows", processed + chunk_len));
        }    on_progress(100.0, "CSV parsing complete");
    
    Ok((headers, all_rows, header_map))
}

/// Helper for parsing CSVs without headers in streaming fashion
fn parse_csv_streaming_no_headers<F>(
    csv_content: &str,
    chunk_size: usize,
    mut on_progress: F,
) -> Result<(Vec<String>, Vec<StringRecord>, AHashMap<String, usize>), Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    on_progress(0.0, "Parsing as headerless CSV...");
    
    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .trim(csv::Trim::All)
        .from_reader(csv_content.as_bytes());
    
    let total_rows = csv_content.lines().count();
    let rows_processed = AtomicUsize::new(0);
    
    let mut all_rows = Vec::with_capacity(total_rows.min(100000));
    let mut chunk = Vec::with_capacity(chunk_size);
    
    // Process first row to determine column count
    let mut col_count = 0;
    for record_result in rdr.records() {
        let record = record_result?;
        if col_count == 0 {
            col_count = record.len();
        }
        chunk.push(record);
        
        if chunk.len() >= chunk_size {
            all_rows.extend(chunk.drain(..));
            let processed = rows_processed.fetch_add(chunk_size, Ordering::Relaxed);
            let progress = (processed as f64 / total_rows as f64) * 95.0 + 5.0;
            on_progress(progress, &format!("Processed {} rows", processed + chunk_size));
        }
    }
    
    if !chunk.is_empty() {
        all_rows.extend(chunk);
    }
    
    if col_count > 0 {
        let auto_headers: Vec<String> = (0..col_count)
            .map(|i| format!("Column{}", i + 1))
            .collect();
        
        let mut header_map = AHashMap::new();
        for (i, h) in auto_headers.iter().enumerate() {
            header_map.insert(h.clone(), i);
        }
        
        on_progress(100.0, "Headerless CSV parsing complete");
        Ok((auto_headers, all_rows, header_map))
    } else {
        Ok((vec![], vec![], AHashMap::new()))
    }
}
