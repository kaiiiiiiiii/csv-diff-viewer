mod types;
mod utils;
mod core;

#[cfg(test)]
mod test_data;

use wasm_bindgen::prelude::*;
use serde::Serialize;
use js_sys::Function;
use crate::types::ParseResult;
use crate::utils::record_to_hashmap;

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
}
