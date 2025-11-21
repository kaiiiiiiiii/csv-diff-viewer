//! Test data module with CSV datasets and expected diff results
//! 
//! This module provides inline test cases with known results for comprehensive
//! testing of the CSV diff engine, including edge cases and validation scenarios.

/// Test case structure containing source/target CSV and expected results
pub struct TestCase {
    pub name: &'static str,
    #[allow(dead_code)]
    pub description: &'static str,
    pub source_csv: &'static str,
    pub target_csv: &'static str,
    pub options: TestOptions,
    pub expected: ExpectedResult,
}

/// Options for test case execution
pub struct TestOptions {
    pub mode: &'static str, // "primary-key" or "content-match"
    pub key_columns: Option<&'static [&'static str]>,
    pub case_sensitive: bool,
    pub ignore_whitespace: bool,
    pub ignore_empty_vs_null: bool,
    pub excluded_columns: &'static [&'static str],
    pub has_headers: bool,
}

/// Expected result structure
pub struct ExpectedResult {
    pub added_count: usize,
    pub removed_count: usize,
    pub modified_count: usize,
    pub unchanged_count: usize,
    pub should_error: bool,
    pub error_message: Option<&'static str>,
}

/// Basic test cases with headers
pub mod basic_with_headers {
    use super::*;

    /// Simple 2x2 CSV with one modification
    pub const SIMPLE_DIFF: TestCase = TestCase {
        name: "simple_diff",
        description: "Basic 2x2 CSV with one field modified",
        source_csv: "id,name,age\n1,Alice,30\n2,Bob,25",
        target_csv: "id,name,age\n1,Alice,30\n2,Bobby,25",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 1,
            unchanged_count: 1,
            should_error: false,
            error_message: None,
        },
    };

    /// Add and remove operations
    pub const ADD_REMOVE: TestCase = TestCase {
        name: "add_remove",
        description: "One row added, one row removed",
        source_csv: "id,name,age\n1,Alice,30\n2,Bob,25\n3,Charlie,35",
        target_csv: "id,name,age\n1,Alice,30\n2,Bob,25\n4,David,28",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 1,
            removed_count: 1,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };

    /// Multiple modifications
    pub const MULTIPLE_MODS: TestCase = TestCase {
        name: "multiple_modifications",
        description: "Multiple fields modified in same row",
        source_csv: "id,name,age,city\n1,Alice,30,NYC\n2,Bob,25,LA\n3,Charlie,35,Chicago",
        target_csv: "id,name,age,city\n1,Alice,31,NYC\n2,Robert,25,San Francisco\n3,Charlie,35,Chicago",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 2,
            unchanged_count: 1,
            should_error: false,
            error_message: None,
        },
    };
}

/// Edge cases: header detection and generation
pub mod header_edge_cases {
    use super::*;

    /// CSV without headers (should auto-detect and generate Column1, Column2, etc.)
    pub const NO_HEADERS_AUTO_DETECT: TestCase = TestCase {
        name: "no_headers_auto_detect",
        description: "CSV without headers should auto-generate Column1, Column2, etc.",
        source_csv: "1,Alice,30\n2,Bob,25\n3,Charlie,35",
        target_csv: "1,Alice,30\n2,Bob,25\n4,David,28",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["Column1"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: false,
        },
        expected: ExpectedResult {
            added_count: 1,
            removed_count: 1,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };

    /// Numeric-looking headers (should be treated as data)
    pub const NUMERIC_HEADERS_AS_DATA: TestCase = TestCase {
        name: "numeric_headers_as_data",
        description: "Numeric-looking headers should be treated as data rows",
        source_csv: "1,2,3\nAlice,30,NYC\nBob,25,LA",
        target_csv: "1,2,3\nAlice,30,NYC\nCharlie,28,Chicago",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["Column1"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true, // Will auto-detect as no headers
        },
        expected: ExpectedResult {
            added_count: 1,
            removed_count: 1,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };

    /// Empty CSV files
    pub const EMPTY_SOURCE: TestCase = TestCase {
        name: "empty_source",
        description: "Empty source CSV, all target rows should be added",
        source_csv: "id,name,age\n",
        target_csv: "id,name,age\n1,Alice,30\n2,Bob,25",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 2,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };

    pub const EMPTY_TARGET: TestCase = TestCase {
        name: "empty_target",
        description: "Empty target CSV, all source rows should be removed",
        source_csv: "id,name,age\n1,Alice,30\n2,Bob,25",
        target_csv: "id,name,age\n",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 2,
            modified_count: 0,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };

    pub const BOTH_EMPTY: TestCase = TestCase {
        name: "both_empty",
        description: "Both CSVs empty, no differences",
        source_csv: "id,name,age\n",
        target_csv: "id,name,age\n",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };
}

/// Primary key validation and error cases
pub mod primary_key_validation {
    use super::*;

    /// Duplicate primary keys in source (should error)
    pub const DUPLICATE_KEY_SOURCE: TestCase = TestCase {
        name: "duplicate_key_source",
        description: "Duplicate primary keys in source should throw error",
        source_csv: "id,name,age\n1,Alice,30\n1,Bob,25\n2,Charlie,35",
        target_csv: "id,name,age\n1,Alice,30\n2,Bob,25\n3,David,28",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 0,
            should_error: true,
            error_message: Some("Duplicate Primary Key found in source"),
        },
    };

    /// Duplicate primary keys in target (should error)
    pub const DUPLICATE_KEY_TARGET: TestCase = TestCase {
        name: "duplicate_key_target",
        description: "Duplicate primary keys in target should throw error",
        source_csv: "id,name,age\n1,Alice,30\n2,Bob,25\n3,Charlie,35",
        target_csv: "id,name,age\n1,Alice,30\n2,Bob,25\n2,David,28",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 0,
            should_error: true,
            error_message: Some("Duplicate Primary Key found in target"),
        },
    };

    /// Missing primary key column in source (should error)
    pub const MISSING_KEY_SOURCE: TestCase = TestCase {
        name: "missing_key_source",
        description: "Missing primary key column in source should throw error",
        source_csv: "name,age\nAlice,30\nBob,25",
        target_csv: "id,name,age\n1,Alice,30\n2,Bob,25",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 0,
            should_error: true,
            error_message: Some("Primary key column \"id\" not found in source"),
        },
    };

    /// Missing primary key column in target (should error)
    pub const MISSING_KEY_TARGET: TestCase = TestCase {
        name: "missing_key_target",
        description: "Missing primary key column in target should throw error",
        source_csv: "id,name,age\n1,Alice,30\n2,Bob,25",
        target_csv: "name,age\nAlice,30\nBob,25",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 0,
            should_error: true,
            error_message: Some("Primary key column \"id\" not found in target"),
        },
    };

    /// Composite primary key (multiple columns)
    pub const COMPOSITE_KEY: TestCase = TestCase {
        name: "composite_key",
        description: "Composite primary key using multiple columns",
        source_csv: "first_name,last_name,age,city\nAlice,Smith,30,NYC\nBob,Jones,25,LA\nCharlie,Brown,35,Chicago",
        target_csv: "first_name,last_name,age,city\nAlice,Smith,31,NYC\nBob,Jones,25,San Francisco\nDavid,Wilson,28,Seattle",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["first_name", "last_name"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 1,
            removed_count: 1,
            modified_count: 2,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };
}

/// Content match mode tests
pub mod content_match_mode {
    use super::*;

    /// Basic content match without primary keys
    pub const BASIC_CONTENT_MATCH: TestCase = TestCase {
        name: "basic_content_match",
        description: "Content-based matching without primary keys",
        source_csv: "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago",
        target_csv: "name,age,city\nAlice,30,NYC\nBob,25,San Francisco\nDavid,28,Seattle",
        options: TestOptions {
            mode: "content-match",
            key_columns: None,
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 1,
            removed_count: 1,
            modified_count: 1,
            unchanged_count: 1,
            should_error: false,
            error_message: None,
        },
    };

    /// Content match with exact fingerprint matches
    pub const EXACT_FINGERPRINT_MATCH: TestCase = TestCase {
        name: "exact_fingerprint_match",
        description: "Content match with exact fingerprint detection",
        source_csv: "id,name,value\n1,Alice,100\n2,Bob,200\n3,Charlie,300",
        target_csv: "id,name,value\n1,Alice,100\n2,Bob,200\n4,David,400",
        options: TestOptions {
            mode: "content-match",
            key_columns: None,
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 1,
            removed_count: 1,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };

    /// Content match with similarity threshold
    pub const SIMILARITY_THRESHOLD: TestCase = TestCase {
        name: "similarity_threshold",
        description: "Content match with similarity scoring (50% threshold)",
        source_csv: "name,age,city\nAlice,30,New York\nBob,25,Los Angeles\nCharlie,35,Chicago",
        target_csv: "name,age,city\nAlice,31,New York City\nRobert,25,LA\nDavid,28,Seattle",
        options: TestOptions {
            mode: "content-match",
            key_columns: None,
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 3,
            removed_count: 3,
            modified_count: 0,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };
}

/// Normalization and comparison options tests
pub mod normalization_options {
    use super::*;

    /// Case sensitivity test
    pub const CASE_SENSITIVE: TestCase = TestCase {
        name: "case_sensitive",
        description: "Case-sensitive comparison should detect case differences",
        source_csv: "id,name\n1,Alice\n2,Bob",
        target_csv: "id,name\n1,alice\n2,BOB",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 2,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };

    /// Case insensitive test
    pub const CASE_INSENSITIVE: TestCase = TestCase {
        name: "case_insensitive",
        description: "Case-insensitive comparison should ignore case differences",
        source_csv: "id,name\n1,Alice\n2,Bob",
        target_csv: "id,name\n1,alice\n2,BOB",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: false,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };

    /// Whitespace handling test
    pub const WHITESPACE_HANDLING: TestCase = TestCase {
        name: "whitespace_handling",
        description: "Ignore whitespace option should normalize spaces",
        source_csv: "id,name\n1,Alice Smith\n2,Bob Jones",
        target_csv: "id,name\n1,  Alice   Smith  \n2,BobJones",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: true,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 2,
            unchanged_count: 0,
            should_error: false,
            error_message: None,
        },
    };

    /// Empty vs null handling test
    pub const EMPTY_VS_NULL: TestCase = TestCase {
        name: "empty_vs_null",
        description: "Empty string and 'null' should be treated as equivalent",
        source_csv: "id,name,value\n1,Alice,\n2,Bob,null",
        target_csv: "id,name,value\n1,Alice,null\n2,Bob,",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: true,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };

    /// Excluded columns test
    pub const EXCLUDED_COLUMNS: TestCase = TestCase {
        name: "excluded_columns",
        description: "Excluded columns should not affect diff results",
        source_csv: "id,name,age,timestamp\n1,Alice,30,2023-01-01\n2,Bob,25,2023-01-02",
        target_csv: "id,name,age,timestamp\n1,Alice,30,2023-01-03\n2,Bob,25,2023-01-04",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &["timestamp"],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 0,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };
}

/// Malformed CSV and edge cases
pub mod malformed_csv {
    use super::*;

    /// CSV with quoted fields containing commas
    pub const QUOTED_FIELDS_WITH_COMMAS: TestCase = TestCase {
        name: "quoted_fields_with_commas",
        description: "CSV with quoted fields containing commas",
        source_csv: "id,name,address\n1,Alice,\"123 Main St, Apt 4B\"\n2,Bob,\"456 Oak Ave\"",
        target_csv: "id,name,address\n1,Alice,\"123 Main St, Apt 4B\"\n2,Bob,\"789 Pine Rd\"",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 1,
            unchanged_count: 1,
            should_error: false,
            error_message: None,
        },
    };

    /// CSV with escaped quotes
    pub const ESCAPED_QUOTES: TestCase = TestCase {
        name: "escaped_quotes",
        description: "CSV with escaped quotes in fields",
        source_csv: "id,quote\n1,\"She said \"\"Hello\"\"\"\n2,\"He said \"\"Goodbye\"\"\"",
        target_csv: "id,quote\n1,\"She said \"\"Hello\"\"\"\n2,\"He said \"\"Hi\"\"\"",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 1,
            unchanged_count: 1,
            should_error: false,
            error_message: None,
        },
    };

    /// CSV with mixed line endings
    pub const MIXED_LINE_ENDINGS: TestCase = TestCase {
        name: "mixed_line_endings",
        description: "CSV with mixed line endings (CRLF and LF)",
        source_csv: "id,name\r\n1,Alice\r\n2,Bob\n3,Charlie",
        target_csv: "id,name\r\n1,Alice\r\n2,Bobby\n3,Charlie",
        options: TestOptions {
            mode: "primary-key",
            key_columns: Some(&["id"]),
            case_sensitive: true,
            ignore_whitespace: false,
            ignore_empty_vs_null: false,
            excluded_columns: &[],
            has_headers: true,
        },
        expected: ExpectedResult {
            added_count: 0,
            removed_count: 0,
            modified_count: 1,
            unchanged_count: 2,
            should_error: false,
            error_message: None,
        },
    };
}

/// Get all test cases for iteration
pub fn get_all_test_cases() -> Vec<&'static TestCase> {
    vec![
        // Basic with headers
        &basic_with_headers::SIMPLE_DIFF,
        &basic_with_headers::ADD_REMOVE,
        &basic_with_headers::MULTIPLE_MODS,
        
        // Header edge cases
        &header_edge_cases::NO_HEADERS_AUTO_DETECT,
        &header_edge_cases::NUMERIC_HEADERS_AS_DATA,
        &header_edge_cases::EMPTY_SOURCE,
        &header_edge_cases::EMPTY_TARGET,
        &header_edge_cases::BOTH_EMPTY,
        
        // Primary key validation
        &primary_key_validation::DUPLICATE_KEY_SOURCE,
        &primary_key_validation::DUPLICATE_KEY_TARGET,
        &primary_key_validation::MISSING_KEY_SOURCE,
        &primary_key_validation::MISSING_KEY_TARGET,
        &primary_key_validation::COMPOSITE_KEY,
        
        // Content match mode
        &content_match_mode::BASIC_CONTENT_MATCH,
        &content_match_mode::EXACT_FINGERPRINT_MATCH,
        &content_match_mode::SIMILARITY_THRESHOLD,
        
        // Normalization options
        &normalization_options::CASE_SENSITIVE,
        &normalization_options::CASE_INSENSITIVE,
        &normalization_options::WHITESPACE_HANDLING,
        &normalization_options::EMPTY_VS_NULL,
        &normalization_options::EXCLUDED_COLUMNS,
        
        // Malformed CSV
        &malformed_csv::QUOTED_FIELDS_WITH_COMMAS,
        &malformed_csv::ESCAPED_QUOTES,
        &malformed_csv::MIXED_LINE_ENDINGS,
    ]
}
