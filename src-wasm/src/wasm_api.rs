use wasm_bindgen::prelude::*;
use serde::Serialize;
use js_sys::Function;
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

    // TODO: Implement dedicated parallel version using parallel::parallel_compare_rows
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
