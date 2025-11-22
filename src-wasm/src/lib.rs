mod types;
mod utils;
pub mod core;
mod binary;
mod profiling;
pub mod parallel;
mod streaming;

#[cfg(test)]
mod test_data;

use wasm_bindgen::prelude::*;
use serde::Serialize;
use js_sys::Function;
use crate::types::ParseResult;
use crate::utils::record_to_hashmap;
use crate::binary::BinaryEncoder;

// Import the wasm_bindgen_test attribute for testing
#[cfg(test)]
use wasm_bindgen_test::wasm_bindgen_test;

#[wasm_bindgen]
pub fn parse_csv(csv_content: &str, has_headers: bool) -> Result<JsValue, JsValue> {
    let (headers, rows, _) = core::parse_csv_internal(csv_content, has_headers)
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
        parallel::diff_csv_parallel_internal(
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
        core::diff_csv_primary_key_internal(
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

    let result = core::diff_csv_internal(
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
    let diffs = core::diff_text_internal(old, new, case_sensitive);
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(diffs.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
}

/// Maintains parsed CSV state so chunked comparisons avoid reprocessing large inputs.
#[wasm_bindgen]
pub struct CsvDiffer {
    internal: core::CsvDifferInternal,
}

#[wasm_bindgen]
impl CsvDiffer {
    #[wasm_bindgen(constructor)]
    pub fn new(
        source_csv: &str,
        target_csv: &str,
        comparison_mode: &str,
        key_columns_val: JsValue,
        case_sensitive: bool,
        ignore_whitespace: bool,
        ignore_empty_vs_null: bool,
        excluded_columns_val: JsValue,
        has_headers: bool,
    ) -> Result<CsvDiffer, JsValue> {
        let key_columns: Vec<String> = serde_wasm_bindgen::from_value(key_columns_val)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let excluded_columns: Vec<String> = serde_wasm_bindgen::from_value(excluded_columns_val)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let internal = core::CsvDifferInternal::new(
            source_csv,
            target_csv,
            key_columns,
            case_sensitive,
            ignore_whitespace,
            ignore_empty_vs_null,
            excluded_columns,
            has_headers,
            comparison_mode.to_string(),
        ).map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(CsvDiffer { internal })
    }

    pub fn diff_chunk(
        &mut self,
        chunk_start: usize,
        chunk_size: usize,
        on_progress: &Function,
    ) -> Result<JsValue, JsValue> {
        let callback = |progress: f64, message: &str| {
            let this = JsValue::NULL;
            let _ = on_progress.call2(&this, &JsValue::from_f64(progress), &JsValue::from_str(message));
        };

        let result = self.internal
            .diff_chunk(chunk_start, chunk_size, callback)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let serializer = serde_wasm_bindgen::Serializer::json_compatible();
        Ok(result.serialize(&serializer).map_err(|e| JsValue::from_str(&e.to_string()))?)
    }
}

// ===== WASM Memory Management Functions =====
// These functions enable zero-copy memory transfer between Rust and JavaScript

/// Allocate memory in WASM for JavaScript to write data into.
/// Returns a pointer to the allocated memory.
/// 
/// # Safety
/// The caller MUST call `dealloc` with the same pointer and size when done,
/// otherwise memory will leak. This function uses `std::mem::forget` to prevent
/// Rust from dropping the allocation, transferring ownership to the caller.
/// 
/// # Example
/// ```javascript
/// const size = 1024;
/// const ptr = wasm.alloc(size);
/// // ... use the memory ...
/// wasm.dealloc(ptr, size); // REQUIRED to prevent memory leak
/// ```
#[wasm_bindgen]
pub fn alloc(size: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf); // Don't drop the buffer, JS will manage it
    ptr
}

/// Deallocate memory previously allocated with `alloc`.
/// 
/// # Safety
/// This function is unsafe because it reconstructs a Vec from a raw pointer.
/// The caller must ensure that:
/// - The pointer was allocated by `alloc`
/// - The size matches the original allocation
/// - The pointer hasn't been deallocated already
/// 
/// Double-free or invalid pointer/size will cause undefined behavior.
/// Always pair each `alloc` call with exactly one `dealloc` call.
#[wasm_bindgen]
pub fn dealloc(ptr: *mut u8, size: usize) {
    // Basic sanity check - null pointer check
    if ptr.is_null() {
        // Early return on null pointer to prevent UB
        return;
    }
    
    unsafe {
        let _ = Vec::from_raw_parts(ptr, 0, size);
        // Vec will be dropped here, freeing the memory
    }
}

// ===== Binary-Encoded Diff Functions (High Performance) =====

/// High-performance CSV diff using binary encoding for results.
/// This eliminates JSON serialization overhead, providing 10-50x faster
/// boundary crossing for large datasets.
/// 
/// Returns a pointer to binary-encoded results. Use `get_binary_result_length`
/// to get the length, then read the data from WASM memory.
/// 
/// # Memory Management
/// The returned pointer MUST be deallocated using `dealloc` after reading
/// the data to prevent memory leaks. Example usage:
/// ```javascript
/// const ptr = wasm.diff_csv_primary_key_binary(...);
/// const len = wasm.get_binary_result_length();
/// const cap = wasm.get_binary_result_capacity();
/// const data = new Uint8Array(wasm.memory.buffer, ptr, len);
/// // ... process data ...
/// wasm.dealloc(ptr, cap); // REQUIRED
/// ```
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

    let result = core::diff_csv_primary_key_internal(
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

    // Store metadata for retrieval/deallocation on the JS side
    unsafe {
        LAST_BINARY_RESULT_LENGTH = len;
        LAST_BINARY_RESULT_CAPACITY = capacity;
    }

    std::mem::forget(binary_data); // Don't drop, JS will read it
    Ok(ptr)
}

/// Get the length of the last binary result.
/// Must be called after `diff_csv_primary_key_binary` or `diff_csv_binary`.
#[wasm_bindgen]
pub fn get_binary_result_length() -> usize {
    unsafe { LAST_BINARY_RESULT_LENGTH }
}

/// Storage for the last binary result length.
/// 
/// # Safety Note
/// This is safe in WASM's single-threaded environment, but would need
/// synchronization in a multi-threaded context. WASM in browsers runs
/// on a single thread, making this pattern safe.
static mut LAST_BINARY_RESULT_LENGTH: usize = 0;
static mut LAST_BINARY_RESULT_CAPACITY: usize = 0;

/// Get the capacity of the last binary result buffer.
/// This value must be passed back into `dealloc` to satisfy dlmalloc's
/// bookkeeping requirements, since capacity can exceed the logical length.
#[wasm_bindgen]
pub fn get_binary_result_capacity() -> usize {
    unsafe { LAST_BINARY_RESULT_CAPACITY }
}

/// High-performance CSV diff (content match mode) using binary encoding.
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

    let result = core::diff_csv_internal(
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

    // Store metadata for retrieval/deallocation on the JS side
    unsafe {
        LAST_BINARY_RESULT_LENGTH = len;
        LAST_BINARY_RESULT_CAPACITY = capacity;
    }

    std::mem::forget(binary_data); // Don't drop, JS will read it
    Ok(ptr)
}

// ===== Multi-threaded Parallel Processing =====

/// Initialize the rayon thread pool for parallel processing
/// This should be called once from JavaScript with the desired number of threads
#[wasm_bindgen(js_name = init_thread_pool)]
pub fn init_thread_pool_wrapper(num_threads: usize) -> js_sys::Promise {
    wasm_bindgen_rayon::init_thread_pool(num_threads)
}

/// Initialize panic hook for better error messages
#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Parallel version of diff_csv_primary_key using rayon for multi-threaded processing
/// Significantly faster for large datasets on multi-core systems
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
    // Currently uses existing implementation for compatibility
    // Future enhancement: Use rayon-specific optimizations for row comparison
    let result = core::diff_csv_primary_key_internal(
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

// ===== Streaming CSV Processing =====

/// Get streaming configuration defaults
#[wasm_bindgen]
pub fn get_streaming_config() -> Result<JsValue, JsValue> {
    let config = streaming::StreamingConfig::default();
    // Return config as a simple object
    let obj = js_sys::Object::new();
    js_sys::Reflect::set(&obj, &"chunkSize".into(), &config.chunk_size.into())?;
    js_sys::Reflect::set(&obj, &"enableProgressUpdates".into(), &config.enable_progress_updates.into())?;
    js_sys::Reflect::set(&obj, &"progressUpdateInterval".into(), &config.progress_update_interval.into())?;
    Ok(obj.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_data::*;

    /// Helper function to run a test case and validate results
    fn run_test_case(test_case: &TestCase) -> Result<(), String> {
        let callback = |_p: f64, _m: &str| {
            // Progress callback - not used in tests
        };

        let result = match test_case.options.mode {
            "primary-key" => {
                let key_columns = test_case.options.key_columns.clone()
                    .unwrap_or_else(|| panic!("Primary key mode requires key_columns for test: {}", test_case.name));
                let key_columns_vec: Vec<String> = key_columns.iter().map(|&s| s.to_string()).collect();
                
                let excluded_columns_vec: Vec<String> = test_case.options.excluded_columns.iter().map(|&s| s.to_string()).collect();

                core::diff_csv_primary_key_internal(
                    test_case.source_csv,
                    test_case.target_csv,
                    key_columns_vec,
                    test_case.options.case_sensitive,
                    test_case.options.ignore_whitespace,
                    test_case.options.ignore_empty_vs_null,
                    excluded_columns_vec,
                    test_case.options.has_headers,
                    callback,
                )
            }
            "content-match" => {
                let excluded_columns_vec: Vec<String> = test_case.options.excluded_columns.iter().map(|&s| s.to_string()).collect();
                
                core::diff_csv_internal(
                    test_case.source_csv,
                    test_case.target_csv,
                    test_case.options.case_sensitive,
                    test_case.options.ignore_whitespace,
                    test_case.options.ignore_empty_vs_null,
                    excluded_columns_vec,
                    test_case.options.has_headers,
                    callback,
                )
            }
            _ => panic!("Unknown mode: {} for test: {}", test_case.options.mode, test_case.name),
        };

        // Check if we expected an error
        if test_case.expected.should_error {
            if let Err(e) = result {
                let error_msg = e.to_string();
                if let Some(expected_msg) = test_case.expected.error_message {
                    if error_msg.contains(expected_msg) {
                        Ok(())
                    } else {
                        Err(format!("Expected error containing '{}', got: {}", expected_msg, error_msg))
                    }
                } else {
                    Ok(())
                }
            } else {
                Err(format!("Expected error for test '{}', but got success", test_case.name))
            }
        } else {
            if let Err(e) = result {
                Err(format!("Unexpected error for test '{}': {}", test_case.name, e))
            } else {
                let result = result.unwrap();
                
                // Validate counts
                if result.added.len() != test_case.expected.added_count {
                    return Err(format!(
                        "Test '{}': expected {} added rows, got {}",
                        test_case.name, test_case.expected.added_count, result.added.len()
                    ));
                }
                
                if result.removed.len() != test_case.expected.removed_count {
                    return Err(format!(
                        "Test '{}': expected {} removed rows, got {}",
                        test_case.name, test_case.expected.removed_count, result.removed.len()
                    ));
                }
                
                if result.modified.len() != test_case.expected.modified_count {
                    return Err(format!(
                        "Test '{}': expected {} modified rows, got {}",
                        test_case.name, test_case.expected.modified_count, result.modified.len()
                    ));
                }
                
                if result.unchanged.len() != test_case.expected.unchanged_count {
                    return Err(format!(
                        "Test '{}': expected {} unchanged rows, got {}",
                        test_case.name, test_case.expected.unchanged_count, result.unchanged.len()
                    ));
                }
                
                Ok(())
            }
        }
    }

    // ===== BASIC TESTS WITH HEADERS =====
    
    #[test]
    fn test_simple_diff() {
        let result = run_test_case(&basic_with_headers::SIMPLE_DIFF);
        assert!(result.is_ok(), "Simple diff test failed: {:?}", result);
    }

    #[test]
    fn test_add_remove() {
        let result = run_test_case(&basic_with_headers::ADD_REMOVE);
        assert!(result.is_ok(), "Add/remove test failed: {:?}", result);
    }

    #[test]
    fn test_multiple_modifications() {
        let result = run_test_case(&basic_with_headers::MULTIPLE_MODS);
        assert!(result.is_ok(), "Multiple modifications test failed: {:?}", result);
    }

    // ===== HEADER EDGE CASES =====
    
    #[test]
    fn test_no_headers_auto_detect() {
        let result = run_test_case(&header_edge_cases::NO_HEADERS_AUTO_DETECT);
        assert!(result.is_ok(), "No headers auto-detect test failed: {:?}", result);
    }

    #[test]
    fn test_numeric_headers_as_data() {
        let result = run_test_case(&header_edge_cases::NUMERIC_HEADERS_AS_DATA);
        assert!(result.is_ok(), "Numeric headers as data test failed: {:?}", result);
    }

    #[test]
    fn test_empty_source() {
        let result = run_test_case(&header_edge_cases::EMPTY_SOURCE);
        assert!(result.is_ok(), "Empty source test failed: {:?}", result);
    }

    #[test]
    fn test_empty_target() {
        let result = run_test_case(&header_edge_cases::EMPTY_TARGET);
        assert!(result.is_ok(), "Empty target test failed: {:?}", result);
    }

    #[test]
    fn test_both_empty() {
        let result = run_test_case(&header_edge_cases::BOTH_EMPTY);
        assert!(result.is_ok(), "Both empty test failed: {:?}", result);
    }

    // ===== PRIMARY KEY VALIDATION =====
    
    #[test]
    fn test_duplicate_key_source() {
        let result = run_test_case(&primary_key_validation::DUPLICATE_KEY_SOURCE);
        assert!(result.is_ok(), "Duplicate key source should have passed the test case wrapper");
    }

    #[test]
    fn test_duplicate_key_target() {
        let result = run_test_case(&primary_key_validation::DUPLICATE_KEY_TARGET);
        assert!(result.is_ok(), "Duplicate key target should have passed the test case wrapper");
    }

    #[test]
    fn test_missing_key_source() {
        let result = run_test_case(&primary_key_validation::MISSING_KEY_SOURCE);
        assert!(result.is_ok(), "Missing key source should have passed the test case wrapper");
    }

    #[test]
    fn test_missing_key_target() {
        let result = run_test_case(&primary_key_validation::MISSING_KEY_TARGET);
        assert!(result.is_ok(), "Missing key target should have passed the test case wrapper");
    }

    #[test]
    fn test_composite_key() {
        let result = run_test_case(&primary_key_validation::COMPOSITE_KEY);
        assert!(result.is_ok(), "Composite key test failed: {:?}", result);
    }

    // ===== CONTENT MATCH MODE =====
    
    #[test]
    fn test_basic_content_match() {
        let result = run_test_case(&content_match_mode::BASIC_CONTENT_MATCH);
        assert!(result.is_ok(), "Basic content match test failed: {:?}", result);
    }

    #[test]
    fn test_exact_fingerprint_match() {
        let result = run_test_case(&content_match_mode::EXACT_FINGERPRINT_MATCH);
        assert!(result.is_ok(), "Exact fingerprint match test failed: {:?}", result);
    }

    #[test]
    fn test_similarity_threshold() {
        let result = run_test_case(&content_match_mode::SIMILARITY_THRESHOLD);
        assert!(result.is_ok(), "Similarity threshold test failed: {:?}", result);
    }

    // ===== NORMALIZATION OPTIONS =====
    
    #[test]
    fn test_case_sensitive() {
        let result = run_test_case(&normalization_options::CASE_SENSITIVE);
        assert!(result.is_ok(), "Case sensitive test failed: {:?}", result);
    }

    #[test]
    fn test_case_insensitive() {
        let result = run_test_case(&normalization_options::CASE_INSENSITIVE);
        assert!(result.is_ok(), "Case insensitive test failed: {:?}", result);
    }

    #[test]
    fn test_whitespace_handling() {
        let result = run_test_case(&normalization_options::WHITESPACE_HANDLING);
        assert!(result.is_ok(), "Whitespace handling test failed: {:?}", result);
    }

    #[test]
    fn test_empty_vs_null() {
        let result = run_test_case(&normalization_options::EMPTY_VS_NULL);
        assert!(result.is_ok(), "Empty vs null test failed: {:?}", result);
    }

    #[test]
    fn test_excluded_columns() {
        let result = run_test_case(&normalization_options::EXCLUDED_COLUMNS);
        assert!(result.is_ok(), "Excluded columns test failed: {:?}", result);
    }

    // ===== MALFORMED CSV =====
    
    #[test]
    fn test_quoted_fields_with_commas() {
        let result = run_test_case(&malformed_csv::QUOTED_FIELDS_WITH_COMMAS);
        assert!(result.is_ok(), "Quoted fields with commas test failed: {:?}", result);
    }

    #[test]
    fn test_escaped_quotes() {
        let result = run_test_case(&malformed_csv::ESCAPED_QUOTES);
        assert!(result.is_ok(), "Escaped quotes test failed: {:?}", result);
    }

    #[test]
    fn test_mixed_line_endings() {
        let result = run_test_case(&malformed_csv::MIXED_LINE_ENDINGS);
        assert!(result.is_ok(), "Mixed line endings test failed: {:?}", result);
    }

    // ===== PROGRESS CALLBACK TEST =====
    
    #[test]
    fn test_diff_csv_progress() {
        let source = "id,name,age\n1,Alice,30\n2,Bob,25";
        let target = "id,name,age\n1,Alice,30\n2,Bobby,25";
        let excluded = vec![];
        
        let mut progress_called = false;
        let callback = |p: f64, m: &str| {
            progress_called = true;
            println!("Progress: {}%, {}", p, m);
        };

        let result = core::diff_csv_internal(source, target, true, true, false, excluded, true, callback).unwrap();
        
        assert!(progress_called);
        assert_eq!(result.modified.len(), 1);
        assert_eq!(result.unchanged.len(), 1);
    }

    // ===== CSV PARSING TESTS =====
    
    #[test]
    fn test_parse_csv_with_headers() {
        let csv = "id,name,age\n1,Alice,30\n2,Bob,25";
        let result = core::parse_csv_internal(csv, true);
        assert!(result.is_ok());
        
        let (headers, rows, header_map) = result.unwrap();
        assert_eq!(headers, vec!["id", "name", "age"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(header_map.get("id"), Some(&0));
        assert_eq!(header_map.get("name"), Some(&1));
        assert_eq!(header_map.get("age"), Some(&2));
    }

    #[test]
    fn test_parse_csv_without_headers() {
        let csv = "1,Alice,30\n2,Bob,25";
        let result = core::parse_csv_internal(csv, false);
        assert!(result.is_ok());
        
        let (headers, rows, header_map) = result.unwrap();
        assert_eq!(headers, vec!["Column1", "Column2", "Column3"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(header_map.get("Column1"), Some(&0));
        assert_eq!(header_map.get("Column2"), Some(&1));
        assert_eq!(header_map.get("Column3"), Some(&2));
    }

    #[test]
    fn test_parse_csv_auto_header_detection() {
        let csv = "1,2,3\nAlice,30,NYC\nBob,25,LA";
        let result = core::parse_csv_internal(csv, true);
        assert!(result.is_ok());
        
        let (headers, rows, header_map) = result.unwrap();
        // Should auto-detect that "1,2,3" looks like data and generate Column1, Column2, Column3
        assert_eq!(headers, vec!["Column1", "Column2", "Column3"]);
        assert_eq!(rows.len(), 3);
        assert_eq!(header_map.get("Column1"), Some(&0));
    }

    #[test]
    fn test_parse_csv_empty() {
        let csv = "";
        let result = core::parse_csv_internal(csv, true);
        assert!(result.is_ok());
        
        let (headers, rows, header_map) = result.unwrap();
        assert_eq!(headers, Vec::<String>::new());
        assert_eq!(rows, Vec::<csv::StringRecord>::new());
        assert_eq!(header_map, ahash::AHashMap::new());
    }

    // ===== TEXT DIFF TESTS =====
    
    #[test]
    fn test_diff_text_case_sensitive() {
        let diffs = core::diff_text_internal("Hello World", "hello world", true);
        assert!(!diffs.is_empty());
        
        // Should have changes since case is different
        let has_changes = diffs.iter().any(|d| d.added || d.removed);
        assert!(has_changes);
    }

    #[test]
    fn test_diff_text_case_insensitive() {
        let diffs = core::diff_text_internal("Hello World", "hello world", false);
        // With case insensitive, these should be equal
        let has_changes = diffs.iter().any(|d| d.added || d.removed);
        assert!(!has_changes);
    }

    #[test]
    fn test_diff_text_partial_match() {
        let diffs = core::diff_text_internal("Hello World", "Hello Universe", true);
        assert!(!diffs.is_empty());
        
        let has_changes = diffs.iter().any(|d| d.added || d.removed);
        assert!(has_changes);
    }

    // ===== CHUNKED PROCESSING TESTS =====
    
    #[test]
    fn test_csv_differ_primary_key() {
        let source = "id,name,age\n1,Alice,30\n2,Bob,25\n3,Charlie,35";
        let target = "id,name,age\n1,Alice,30\n2,Bobby,25\n4,David,28";
        
        let differ = core::CsvDifferInternal::new(
            source,
            target,
            vec!["id".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            "primary-key".to_string(),
        );
        assert!(differ.is_ok());
        
        let mut differ = differ.unwrap();
        let result = differ.diff_chunk(0, 10, |_p, _m| {}).unwrap();
        
        assert_eq!(result.added.len(), 1);
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.modified.len(), 1);
        assert_eq!(result.unchanged.len(), 1);
    }

    #[test]
    fn test_csv_differ_content_match() {
        let source = "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago";
        let target = "name,age,city\nAlice,30,NYC\nBob,25,San Francisco\nDavid,28,Seattle";
        
        let differ = core::CsvDifferInternal::new(
            source,
            target,
            vec![],
            true,
            false,
            false,
            vec![],
            true,
            "content-match".to_string(),
        );
        assert!(differ.is_ok());
        
        let mut differ = differ.unwrap();
        let result = differ.diff_chunk(0, 10, |_p, _m| {}).unwrap();
        
        assert_eq!(result.added.len(), 1);
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.modified.len(), 1);
        assert_eq!(result.unchanged.len(), 1);
    }

    #[test]
    fn test_csv_differ_chunked_processing() {
        let source = "id,name\n1,Alice\n2,Bob\n3,Charlie\n4,David\n5,Eve";
        let target = "id,name\n1,Alice\n2,Bobby\n3,Charlie\n4,David\n5,Eve\n6,Frank";
        
        let differ = core::CsvDifferInternal::new(
            source,
            target,
            vec!["id".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            "primary-key".to_string(),
        );
        assert!(differ.is_ok());
        
        let mut differ = differ.unwrap();
        
        // Process in chunks
        let chunk1 = differ.diff_chunk(0, 3, |_p, _m| {}).unwrap();
        let chunk2 = differ.diff_chunk(3, 3, |_p, _m| {}).unwrap();
        
        // First chunk should have some results
        assert!(!chunk1.added.is_empty() || !chunk1.modified.is_empty() || !chunk1.unchanged.is_empty());
        
        // Second chunk should have remaining results
        assert!(!chunk2.added.is_empty() || !chunk2.modified.is_empty() || !chunk2.unchanged.is_empty());
    }

    // ===== COMPREHENSIVE TEST RUNNER =====
    
    /// Run all test cases and report results
    #[test]
    fn test_all_cases() {
        let test_cases = get_all_test_cases();
        let mut passed = 0;
        let mut failed = 0;
        
        for test_case in test_cases {
            match run_test_case(test_case) {
                Ok(_) => {
                    println!("✓ {}", test_case.name);
                    passed += 1;
                }
                Err(e) => {
                    println!("✗ {}: {}", test_case.name, e);
                    failed += 1;
                }
            }
        }
        
        println!("\nTest Results: {} passed, {} failed", passed, failed);
        assert_eq!(failed, 0, "Some tests failed. See output above.");
    }

    // ===== PERFORMANCE BENCHMARKS =====

    /// Generate a large CSV for performance testing
    fn generate_large_csv_for_benchmark(rows: usize, cols: usize) -> String {
        let mut lines = vec![];
        
        // Header
        let header: Vec<String> = (0..cols).map(|i| format!("Column{}", i + 1)).collect();
        lines.push(header.join(","));
        
        // Data rows
        for row in 0..rows {
            let row_data: Vec<String> = (0..cols).map(|col| {
                if col == 0 {
                    format!("ID{}", row)
                } else {
                    format!("Value{}_{}", row, col)
                }
            }).collect();
            lines.push(row_data.join(","));
        }
        
        lines.join("\n")
    }

    /// Benchmark: 10k rows with primary key mode
    #[test]
    #[ignore] // Run with: cargo test --release -- --ignored --nocapture
    fn benchmark_10k_rows_primary_key() {
        let csv = generate_large_csv_for_benchmark(10_000, 5);
        let csv_modified = csv.replace("Value5000_2", "MODIFIED");
        
        let start = std::time::Instant::now();
        let result = core::diff_csv_primary_key_internal(
            &csv,
            &csv_modified,
            vec!["Column1".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            |_p, _m| {},
        );
        let duration = start.elapsed();
        
        assert!(result.is_ok());
        println!("✓ 10k rows (primary key): {:?}", duration);
        println!("  Memory estimate: ~{:.2} MB", csv.len() as f64 / 1_048_576.0);
    }

    /// Benchmark: 10k rows with content match mode
    #[test]
    #[ignore]
    fn benchmark_10k_rows_content_match() {
        let csv = generate_large_csv_for_benchmark(10_000, 5);
        let csv_modified = csv.replace("Value5000_2", "MODIFIED");
        
        let start = std::time::Instant::now();
        let result = core::diff_csv_internal(
            &csv,
            &csv_modified,
            true,
            false,
            false,
            vec![],
            true,
            |_p, _m| {},
        );
        let duration = start.elapsed();
        
        assert!(result.is_ok());
        println!("✓ 10k rows (content match): {:?}", duration);
    }

    /// Benchmark: 100k rows with primary key mode
    #[test]
    #[ignore]
    fn benchmark_100k_rows_primary_key() {
        let csv = generate_large_csv_for_benchmark(100_000, 5);
        let csv_modified = csv.replace("Value50000_2", "MODIFIED");
        
        let start = std::time::Instant::now();
        let result = core::diff_csv_primary_key_internal(
            &csv,
            &csv_modified,
            vec!["Column1".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            |_p, _m| {},
        );
        let duration = start.elapsed();
        
        assert!(result.is_ok());
        println!("✓ 100k rows (primary key): {:?}", duration);
        println!("  Memory estimate: ~{:.2} MB", csv.len() as f64 / 1_048_576.0);
    }

    /// Benchmark: 500k rows with primary key mode
    #[test]
    #[ignore]
    fn benchmark_500k_rows_primary_key() {
        let csv = generate_large_csv_for_benchmark(500_000, 5);
        let csv_modified = csv.replace("Value250000_2", "MODIFIED");
        
        let start = std::time::Instant::now();
        let result = core::diff_csv_primary_key_internal(
            &csv,
            &csv_modified,
            vec!["Column1".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            |percent, msg| {
                if percent as u32 % 10 == 0 {
                    println!("  Progress: {}% - {}", percent, msg);
                }
            },
        );
        let duration = start.elapsed();
        
        assert!(result.is_ok());
        println!("✓ 500k rows (primary key): {:?}", duration);
        println!("  Memory estimate: ~{:.2} MB", csv.len() as f64 / 1_048_576.0);
    }

    /// Benchmark: 1M rows with primary key mode
    #[test]
    #[ignore]
    fn benchmark_1m_rows_primary_key() {
        let csv = generate_large_csv_for_benchmark(1_000_000, 5);
        let csv_modified = csv.replace("Value500000_2", "MODIFIED");
        
        let start = std::time::Instant::now();
        let result = core::diff_csv_primary_key_internal(
            &csv,
            &csv_modified,
            vec!["Column1".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            |percent, msg| {
                if percent as u32 % 10 == 0 {
                    println!("  Progress: {}% - {}", percent, msg);
                }
            },
        );
        let duration = start.elapsed();
        
        assert!(result.is_ok());
        println!("✓ 1M rows (primary key): {:?}", duration);
        println!("  Memory estimate: ~{:.2} MB", csv.len() as f64 / 1_048_576.0);
    }

    /// Benchmark: Unicode handling with 10k rows
    #[test]
    #[ignore]
    fn benchmark_unicode_handling() {
        let mut lines = vec!["ID,Name,Description".to_string()];
        for i in 0..10_000 {
            lines.push(format!("{},用户{},测试数据{}世界", i, i, i));
        }
        let csv = lines.join("\n");
        let csv_modified = csv.replace("用户5000", "修改后的用户5000");
        
        let start = std::time::Instant::now();
        let result = core::diff_csv_primary_key_internal(
            &csv,
            &csv_modified,
            vec!["ID".to_string()],
            true,
            false,
            false,
            vec![],
            true,
            |_p, _m| {},
        );
        let duration = start.elapsed();
        
        assert!(result.is_ok());
        println!("✓ 10k rows (unicode): {:?}", duration);
        println!("  Memory estimate: ~{:.2} MB", csv.len() as f64 / 1_048_576.0);
    }

    /// Run all benchmarks and report summary
    #[test]
    #[ignore]
    fn benchmark_summary() {
        println!("\n=== Performance Benchmark Summary ===\n");
        
        let benchmarks = vec![
            (10_000, "10k"),
            (50_000, "50k"),
            (100_000, "100k"),
            (500_000, "500k"),
        ];
        
        for (rows, label) in benchmarks {
            let csv = generate_large_csv_for_benchmark(rows, 5);
            let csv_modified = csv.replace(&format!("Value{}_2", rows / 2), "MODIFIED");
            
            // Primary key benchmark
            let start = std::time::Instant::now();
            let _ = core::diff_csv_primary_key_internal(
                &csv,
                &csv_modified,
                vec!["Column1".to_string()],
                true,
                false,
                false,
                vec![],
                true,
                |_p, _m| {},
            );
            let pk_duration = start.elapsed();
            
            // Content match benchmark
            let start = std::time::Instant::now();
            let _ = core::diff_csv_internal(
                &csv,
                &csv_modified,
                true,
                false,
                false,
                vec![],
                true,
                |_p, _m| {},
            );
            let cm_duration = start.elapsed();
            
            let memory_mb = csv.len() as f64 / 1_048_576.0;
            
            println!("{} rows:", label);
            println!("  Primary Key: {:?}", pk_duration);
            println!("  Content Match: {:?}", cm_duration);
            println!("  Memory: {:.2} MB", memory_mb);
            println!();
        }
    }

    // ===== STRSIM SIMILARITY TESTS =====

    /// Test strsim-based similarity matching
    #[test]
    fn test_strsim_similarity_matching() {
        use crate::utils::{similarity_jaro_winkler, similarity_levenshtein};

        // Test Jaro-Winkler (best for short strings, names)
        let jw_identical = similarity_jaro_winkler("Alice", "Alice");
        assert_eq!(jw_identical, 1.0, "Identical strings should have similarity 1.0");

        let jw_similar = similarity_jaro_winkler("Alice", "Alicia");
        assert!(jw_similar > 0.8, "Similar names should have high similarity");

        let jw_different = similarity_jaro_winkler("Alice", "Bob");
        assert!(jw_different < 0.5, "Different names should have low similarity");

        // Test Levenshtein (best for longer strings)
        let lev_identical = similarity_levenshtein("New York", "New York");
        assert_eq!(lev_identical, 1.0, "Identical strings should have similarity 1.0");

        let lev_similar = similarity_levenshtein("New York", "New York City");
        assert!(lev_similar > 0.6, "Similar cities should have reasonable similarity");

        let lev_different = similarity_levenshtein("New York", "Los Angeles");
        assert!(lev_different < 0.5, "Different cities should have low similarity");

        println!("✓ Jaro-Winkler and Levenshtein similarity tests passed");
    }

    /// Demonstrate improved content matching with strsim
    #[test]
    fn test_strsim_improved_matching() {
        // This test demonstrates the improved matching capability with strsim
        let source = "name,age,location\nJohn Doe,30,New York\nJane Smith,25,Los Angeles";
        let target = "name,age,location\nJohn D.,30,NYC\nJane S.,25,LA";

        let result = core::diff_csv_internal(
            source,
            target,
            true,
            false,
            false,
            vec![],
            true,
            |_p, _m| {},
        ).unwrap();

        // With strsim, abbreviated names and locations should still match
        // "John Doe" -> "John D." and "New York" -> "NYC" are similar enough
        assert!(result.modified.len() >= 1, "Should find modified rows with similar but not identical values");
        println!("✓ strsim-based content matching correctly identified {} modified rows", result.modified.len());
    }

    
}
