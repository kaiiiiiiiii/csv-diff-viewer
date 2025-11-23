#[cfg(test)]
mod tests {
    use crate::*;
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