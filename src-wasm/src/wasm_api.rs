use wasm_bindgen::prelude::*;
use serde::Serialize;
use js_sys::Function;
use std::collections::HashMap;
use crate::types::{DiffResult, ParseResult};
use crate::utils::record_to_hashmap;
use crate::binary_encoder::BinaryEncoder;
use crate::memory::{set_last_binary_result_length, set_last_binary_result_capacity};

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
    // Return only headers and a sample of the first 5 rows for UI validation
    let (headers, sample) = crate::parse::parse_headers_sample(csv_content, has_headers, 5)
        .map_err(|e| JsValue::from_str(&e))?;

    let sample_rows: Vec<HashMap<String, String>> = sample
        .into_iter()
        .map(|row| {
            let mut cells = row.into_iter();
            headers.iter().map(|h| (h.clone(), cells.next().unwrap_or_default())).collect()
        })
        .collect();

    let result = ParseResult { headers, rows: sample_rows };
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

#[wasm_bindgen]
pub fn parse_csv_with_progress(csv_content: &str, has_headers: bool, on_progress: &Function) -> Result<JsValue, JsValue> {
    // Parse in chunks, reporting progress to the JS callback after each chunk
    let (headers, rows, _) = crate::parse::parse_csv_streaming(
        csv_content, 
        has_headers, 
        5000, // Process in chunks of 5000 rows
        |percent, message| {
            let _ = on_progress.call2(&JsValue::NULL, &JsValue::from_f64(percent), &JsValue::from_str(message));
        }
    ).map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Convert to hashmap format
    let rows_hashmap: Vec<HashMap<String, String>> = rows.iter()
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

/// Encode a diff result and hand the buffer to JS (pointer returned; length and
/// capacity are stored via the memory module and the JS side deallocates it).
fn encode_binary_result(result: &DiffResult) -> *mut u8 {
    let mut encoder = BinaryEncoder::new();
    encoder.encode_diff_result(result);
    let mut binary_data = encoder.into_vec();

    let ptr = binary_data.as_mut_ptr();
    set_last_binary_result_length(binary_data.len());
    set_last_binary_result_capacity(binary_data.capacity());

    std::mem::forget(binary_data); // Don't drop, JS will read it
    ptr
}

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

    Ok(encode_binary_result(&result))
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

    Ok(encode_binary_result(&result))
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

    Ok(encode_binary_result(&result))
}

/// Parallel primary-key diff, binary-encoded. Same parameters as
/// `diff_csv_primary_key_binary`; decode with the same decoder.
#[wasm_bindgen]
pub fn diff_csv_primary_key_parallel_binary(
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

    Ok(encode_binary_result(&result))
}
