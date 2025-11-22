use csv_diff_wasm::core;
use csv_diff_wasm::parallel;

#[test]
fn test_parallel_diff() {
    // Test that parallel implementation produces the same results as sequential
    let source_csv = "id,name,age\n1,John,30\n2,Jane,25\n3,Bob,35";
    let target_csv = "id,name,age\n1,John,30\n2,Jane,26\n4,Alice,28";
    let key_columns = vec!["id".to_string()];
    let excluded_columns = vec![];
    let case_sensitive = true;
    let ignore_whitespace = false;
    let ignore_empty_vs_null = false;
    let has_headers = true;

    // Run sequential implementation
    let sequential_result = core::diff_csv_primary_key_internal(
        source_csv,
        target_csv,
        key_columns.clone(),
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns.clone(),
        has_headers,
        |_, _| {}
    ).unwrap();

    // Run parallel implementation
    let parallel_result = parallel::diff_csv_parallel_internal(
        source_csv,
        target_csv,
        key_columns,
        case_sensitive,
        ignore_whitespace,
        ignore_empty_vs_null,
        excluded_columns,
        has_headers,
        |_, _| {}
    ).unwrap();

    // Compare results
    assert_eq!(sequential_result.added.len(), parallel_result.added.len());
    assert_eq!(sequential_result.removed.len(), parallel_result.removed.len());
    assert_eq!(sequential_result.modified.len(), parallel_result.modified.len());
    assert_eq!(sequential_result.unchanged.len(), parallel_result.unchanged.len());
}
