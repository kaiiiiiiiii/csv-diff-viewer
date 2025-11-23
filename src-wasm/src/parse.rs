use csv::ReaderBuilder;
use csv::StringRecord;
use ahash::AHashMap;

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
