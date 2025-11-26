use wasm_bindgen::prelude::*;
use serde::Serialize;
use js_sys::Function;
use csv::ReaderBuilder;
use crate::types::ParseResult;
use crate::utils::record_to_hashmap;
use crate::binary_encoder::BinaryEncoder;
use crate::memory::{set_last_binary_result_length, set_last_binary_result_capacity};

use rayon::prelude::*;
use std::time::Instant;

#[wasm_bindgen]
pub fn parse_csv(csv_content: &str, has_headers: bool) -> Result<JsValue, JsValue> {
    let (headers, rows, _) = crate::core::parse_csv_internal(csv_content, has_headers)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let rows_hashmap: Vec<_> = rows.iter()
        .map(|r| record_to_hashmap(r, &headers))
        .collect();

    let result = ParseResult { headers, rows: rows_hashmap };
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn parse_csv_headers_only(csv_content: &str, has_headers: bool) -> Result<JsValue, JsValue> {
    let (headers, _, _) = crate::core::parse_csv_internal(csv_content, has_headers)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Return only headers and a sample of the first 5 rows for UI validation
    let sample_rows = if has_headers {
        // Parse just first few rows for sample
        let mut rdr = ReaderBuilder::new()
            .has_headers(true)
            .trim(csv::Trim::All)
            .from_reader(csv_content.as_bytes());
        
        rdr.records()
            .filter_map(Result::ok)
            .take(5)
            .map(|r| record_to_hashmap(&r, &headers))
            .collect()
    } else {
        // For headerless CSV, still provide sample of first 5 rows
        let mut rdr = ReaderBuilder::new()
            .has_headers(false)
            .trim(csv::Trim::All)
            .from_reader(csv_content.as_bytes());
        
        rdr.records()
            .filter_map(Result::ok)
            .take(5)
            .map(|r| record_to_hashmap(&r, &headers))
            .collect()
    };

    let result = ParseResult { headers, rows: sample_rows };
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn parse_csv_with_progress(csv_content: &str, has_headers: bool, on_progress: &Function) -> Result<JsValue, JsValue> {
    // Use the new streaming parser for better memory efficiency and progress reporting
    let (headers, rows, _) = crate::parse::parse_csv_streaming(
        csv_content, 
        has_headers, 
        5000, // Process in chunks of 5000 rows
        |percent, message| {
            let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(percent), &JsValue::from_str(message));
        }
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Convert to hashmap format
    let rows_hashmap: Vec<std::collections::HashMap<String, String>> = rows.iter()
        .map(|r| record_to_hashmap(r, &headers))
        .collect();
        
    let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(100.0), &JsValue::from_str("Parsing complete"));
    
    let result = ParseResult { headers, rows: rows_hashmap };
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn diff_csv_primary_key(
    source_csv: &str,
    target_csv: &str,
    key_columns_val: JsValue,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns_val: JsValue,
    has_headers: bool,
    use_parallel: bool,
    on_progress: &Function,
) -> Result<JsValue, JsValue> {
    let key_columns: Vec<String> = serde_wasm_bindgen::from_value(key_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let callback = |progress: f64, message: &str| {
        let this = JsValue::NULL;
        let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
    };

    let result = if use_parallel {
        crate::parallel::diff_csv_parallel_internal(
            source_csv,
            target_csv,
            key_columns,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            excluded_columns,
            has_headers,
            callback
        ).map_err(|e| JsValue::from_str(&e.to_string()))?
    } else {
        crate::core::diff_csv_primary_key_internal(
            source_csv,
            target_csv,
            key_columns,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            excluded_columns,
            has_headers,
            callback
        ).map_err(|e| JsValue::from_str(&e.to_string()))?
    };

    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn diff_csv(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
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

    let result = crate::core::diff_csv_internal(
        source_csv,
        target_csv,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn diff_text(old: &str, new: &str, case_sensitive: bool) -> Result<JsValue, JsValue> {
    let diffs = crate::core::diff_text_internal(old, new, case_sensitive);
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(diffs.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

// ===== Binary-Encoded Diff Functions (High Performance) =====

#[wasm_bindgen]
pub fn diff_csv_primary_key_binary(
    source_csv: &str,
    target_csv: &str,
    key_columns_val: JsValue,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns_val: JsValue,
    has_headers: bool,
    on_progress: &Function,
) -> Result<*mut u8, JsValue> {
    let key_columns: Vec<String> = serde_wasm_bindgen::from_value(key_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let callback = |progress: f64, message: &str| {
        let this = JsValue::NULL;
        let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
    };

    let result = crate::core::diff_csv_primary_key_internal(
        source_csv,
        target_csv,
        key_columns,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Encode to binary format
    let mut encoder = BinaryEncoder::new();
    encoder.encode_diff_result(&result);
    let mut binary_data = encoder.into_vec();

    // Return pointer to the binary data
    let ptr = binary_data.as_mut_ptr();
    let len = binary_data.len();
    let capacity = binary_data.capacity();

    // Store metadata for retrieval/deallocation on the JS side via memory module
    set_last_binary_result_length(len);
    set_last_binary_result_capacity(capacity);

    std::mem::forget(binary_data); // Don't drop, JS will read it
    Ok(ptr)
}

#[wasm_bindgen]
pub fn diff_csv_binary(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns_val: JsValue,
    has_headers: bool,
    on_progress: &Function,
) -> Result<*mut u8, JsValue> {
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let callback = |progress: f64, message: &str| {
        let this = JsValue::NULL;
        let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
    };

    let result = crate::core::diff_csv_internal(
        source_csv,
        target_csv,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Encode to binary format
    let mut encoder = BinaryEncoder::new();
    encoder.encode_diff_result(&result);
    let mut binary_data = encoder.into_vec();

    // Return pointer to the binary data
    let ptr = binary_data.as_mut_ptr();
    let len = binary_data.len();
    let capacity = binary_data.capacity();

    // Store metadata for retrieval/deallocation on the JS side via memory module
    set_last_binary_result_length(len);
    set_last_binary_result_capacity(capacity);

    std::mem::forget(binary_data); // Don't drop, JS will read it
    Ok(ptr)
}

/// Initialize panic hook for better error messages
#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn diff_csv_primary_key_parallel(
    source_csv: &str,
    target_csv: &str,
    key_columns_val: JsValue,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns_val: JsValue,
    has_headers: bool,
    on_progress: &Function,
) -> Result<JsValue, JsValue> {
    let key_columns: Vec<String> = serde_wasm_bindgen::from_value(key_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let callback = |progress: f64, message: &str| {
        let this = JsValue::NULL;
        let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
    };

    // Use the parallel implementation for primary-key diffs
    let result = crate::parallel::diff_csv_parallel_internal(
        source_csv,
        target_csv,
        key_columns,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn benchmark_parallel() -> f64 {
    let start = Instant::now();
    let data: Vec<u64> = (0..1_000_000u64).collect();
    let _sum: u64 = data.par_iter().map(|&x| x * x).sum::<u64>();
    start.elapsed().as_secs_f64()
}

#[wasm_bindgen]
pub fn get_streaming_config() -> Result<JsValue, JsValue> {
    let config = crate::streaming::StreamingConfig::default();
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"chunkSize".into(), &config.chunk_size.into())?;
    js_sys::Reflect::set(&obj, &"enableProgressUpdates".into(), &config.enable_progress_updates.into())?;
    js_sys::Reflect::set(&obj, &"progressUpdateInterval".into(), &config.progress_update_interval.into())?;
    Ok(obj.into())
}

#[wasm_bindgen]
pub fn diff_csv_parallel(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
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

    let result = crate::parallel::diff_csv_content_match_parallel(
        source_csv,
        target_csv,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn diff_csv_parallel_binary(
    source_csv: &str,
    target_csv: &str,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns_val: JsValue,
    has_headers: bool,
    on_progress: &Function,
) -> Result<*mut u8, JsValue> {
    let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let callback = |progress: f64, message: &str| {
        let this = JsValue::NULL;
        let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
    };

    let result = crate::parallel::diff_csv_content_match_parallel(
        source_csv,
        target_csv,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        callback
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Encode to binary format
    let mut encoder = BinaryEncoder::new();
    encoder.encode_diff_result(&result);
    let mut binary_data = encoder.into_vec();

    // Return pointer to the binary data
    let ptr = binary_data.as_mut_ptr();
    let len = binary_data.len();
    let capacity = binary_data.capacity();

    // Store metadata for retrieval/deallocation on the JS side via memory module
    set_last_binary_result_length(len);
    set_last_binary_result_capacity(capacity);

    std::mem::forget(binary_data); // Don't drop, JS will read it
    Ok(ptr)
}

/// Initialize the Rayon thread pool for parallel processing
/// This should be called before any parallel operations to ensure optimal thread distribution
#[wasm_bindgen]
pub fn init_wasm_thread_pool(num_threads: usize) -> Result<(), JsValue> {
    crate::parallel::init_thread_pool(num_threads);
    Ok(())
}

/// Parse CSV from binary data with zero-copy transfer
/// Accepts a Uint8Array and returns a pointer to the parsed result
#[wasm_bindgen]
pub fn parse_csv_binary(
    csv_data: &[u8],
    has_headers: bool,
    on_progress: &Function,
) -> Result<*const u8, JsValue> {
    // Convert bytes to string (this is unavoidable since CSV is text)
    let csv_content = std::str::from_utf8(csv_data)
        .map_err(|e| JsValue::from_str(&format!("Invalid UTF-8: {}", e)))?;

    // Use streaming parser
    let (headers, rows, _) = crate::parse::parse_csv_streaming(
        csv_content, 
        has_headers, 
        5000,
        |percent, message| {
            let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(percent), &JsValue::from_str(message));
        }
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Convert to binary format for zero-copy transfer
    let rows_hashmap: Vec<_> = rows.iter()
        .map(|r| record_to_hashmap(r, &headers))
        .collect();

    let result = ParseResult { headers, rows: rows_hashmap };
    
    // Serialize to binary
    // Note: We'd need to implement binary encoding for ParseResult
    // For now, fall back to JSON but in a way that can be transferred
    let json_str = serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    
    let binary_data = json_str.into_bytes();
    let ptr = binary_data.as_ptr();
    let len = binary_data.len();
    let capacity = binary_data.capacity();

    // Store metadata for retrieval
    set_last_binary_result_length(len);
    set_last_binary_result_capacity(capacity);

    std::mem::forget(binary_data);
    Ok(ptr)
}

/// Get metadata about the last binary result (length and capacity)
#[wasm_bindgen]
pub fn get_last_binary_result_metadata() -> JsValue {
    use crate::memory::{get_last_binary_result_length, get_last_binary_result_capacity};
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &JsValue::from_str("length"), 
                         &JsValue::from_f64(get_last_binary_result_length() as f64)).unwrap();
    js_sys::Reflect::set(&obj, &JsValue::from_str("capacity"), 
                         &JsValue::from_f64(get_last_binary_result_capacity() as f64)).unwrap();
    obj.into()
}

/// Initialize a differ for chunked processing
#[wasm_bindgen]
pub fn init_differ(
    source_csv: &str,
    target_csv: &str,
    has_headers: bool,
    chunk_size: usize,
    on_progress: &Function,
) -> Result<JsValue, JsValue> {
    let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(0.0), &JsValue::from_str("Initializing differ..."));
    
    // Parse just the headers and count rows
    let (source_headers, source_rows, _source_header_map) = crate::parse::parse_csv_streaming(
        source_csv, 
        has_headers, 
        chunk_size,
        |percent, message| {
            let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(percent * 0.4), &JsValue::from_str(&format!("Source: {}", message)));
        }
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;
    
    let (target_headers, target_rows, _target_header_map) = crate::parse::parse_csv_streaming(
        target_csv, 
        has_headers, 
        chunk_size,
        |percent, message| {
            let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(40.0 + percent * 0.4), &JsValue::from_str(&format!("Target: {}", message)));
        }
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;
    
    let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(80.0), &JsValue::from_str("Building indexes..."));
    
    // Build header maps for fingerprint calculation
    let mut source_header_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, h) in source_headers.iter().enumerate() {
        source_header_map.insert(h.clone(), i);
    }
    
    let mut target_header_map: ahash::AHashMap<String, usize> = ahash::AHashMap::new();
    for (i, h) in target_headers.iter().enumerate() {
        target_header_map.insert(h.clone(), i);
    }
    
    // Build fingerprint indexes for fast matching
    let excluded_set = ahash::AHashSet::<String>::new(); // Empty for now
    
    let source_fingerprints: Vec<u64> = source_rows.iter()
        .map(|row| crate::utils::get_row_fingerprint_hash(
            row,
            &source_headers,
            &source_header_map,
            true, // case_sensitive
            false, // ignore_whitespace
            false, // ignore_empty_vs_null
            &excluded_set,
        ))
        .collect();
    
    let target_fingerprints: Vec<u64> = target_rows.iter()
        .map(|row| crate::utils::get_row_fingerprint_hash(
            row,
            &target_headers,
            &target_header_map,
            true, // case_sensitive
            false, // ignore_whitespace
            false, // ignore_empty_vs_null
            &excluded_set,
        ))
        .collect();
    
    let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(100.0), &JsValue::from_str("Differ initialized"));
    
    // Return differ state as JSON
    let differ_state = serde_json::json!({
        "source_headers": source_headers,
        "target_headers": target_headers,
        "source_rows_count": source_rows.len(),
        "target_rows_count": target_rows.len(),
        "source_fingerprints": source_fingerprints,
        "target_fingerprints": target_fingerprints,
        "chunk_size": chunk_size
    });
    
    Ok(JsValue::from_str(&differ_state.to_string()))
}

/// Process a chunk of the diff
#[wasm_bindgen]
pub fn diff_chunk(
    differ_state: &str,
    chunk_start: usize,
    _mode: &str, // "primary_key" or "content_match"
    _key_columns: JsValue, // Only used for primary_key mode
    _case_sensitive: bool,
    _ignore_whitespace: bool,
    _ignore_empty_vs_null: bool,
    _excluded_columns: JsValue,
    on_progress: &Function,
) -> Result<JsValue, JsValue> {
    // Parse differ state
    let state: serde_json::Value = serde_json::from_str(differ_state)
        .map_err(|e| JsValue::from_str(&format!("Invalid differ state: {}", e)))?;
    
    let _source_headers: Vec<String> = serde_json::from_value(state["source_headers"].clone())
        .map_err(|e| JsValue::from_str(&format!("Invalid source headers: {}", e)))?;
    let _target_headers: Vec<String> = serde_json::from_value(state["target_headers"].clone())
        .map_err(|e| JsValue::from_str(&format!("Invalid target headers: {}", e)))?;
    
    // This is a simplified implementation - in a full implementation, we'd need
    // to store the actual row data and process chunk by chunk
    let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(0.0), &JsValue::from_str("Processing chunk..."));
    
    // For now, return an empty result
    let result = serde_json::json!({
        "added": [],
        "removed": [],
        "modified": [],
        "unchanged": [],
        "total_processed": chunk_start,
        "progress": 0.0
    });
    
    let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(100.0), &JsValue::from_str("Chunk processed"));
    
    Ok(JsValue::from_str(&result.to_string()))
}
