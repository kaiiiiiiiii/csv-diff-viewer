use std::collections::HashMap;

pub fn normalize_value(value: &str, case_sensitive: bool, ignore_whitespace: bool) -> String {
    let mut val = value.to_string();
    if ignore_whitespace {
        val = val.trim().to_string();
    }
    if !case_sensitive {
        val = val.to_lowercase();
    }
    val
}

pub fn is_empty_or_null(value: &str) -> bool {
    let v = value.trim();
    v.is_empty() || v.eq_ignore_ascii_case("null")
}

pub fn normalize_value_with_empty_vs_null(
    value: &str, 
    case_sensitive: bool, 
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool
) -> String {
    let mut val = value.to_string();
    if ignore_whitespace {
        val = val.trim().to_string();
    }
    if !case_sensitive {
        val = val.to_lowercase();
    }
    if ignore_empty_vs_null && is_empty_or_null(&val) {
        val = "EMPTY_OR_NULL".to_string();
    }
    val
}

pub fn get_row_fingerprint(
    row: &HashMap<String, String>,
    headers: &[String],
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns: &[String],
) -> String {
    headers.iter()
        .filter(|h| !excluded_columns.contains(h))
        .map(|h| {
            let val = row.get(h).map(|s| s.as_str()).unwrap_or("");
            normalize_value_with_empty_vs_null(val, case_sensitive, ignore_whitespace, ignore_empty_vs_null)
        })
        .collect::<Vec<_>>()
        .join("||")
}

pub fn get_row_key(
    row: &HashMap<String, String>,
    key_columns: &[String],
) -> String {
    key_columns.iter()
        .map(|k| row.get(k).map(|s| s.as_str()).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("|")
}
