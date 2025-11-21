use std::collections::HashMap;
use csv::StringRecord;
use ahash::AHashMap;
use strsim::{jaro_winkler, normalized_levenshtein};

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
    row: &StringRecord,
    headers: &[String],
    header_map: &AHashMap<String, usize>,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns: &[String],
) -> String {
    headers.iter()
        .filter(|h| !excluded_columns.contains(h))
        .map(|h| {
            let val = if let Some(&idx) = header_map.get(h) {
                row.get(idx).unwrap_or("")
            } else {
                ""
            };
            normalize_value_with_empty_vs_null(val, case_sensitive, ignore_whitespace, ignore_empty_vs_null)
        })
        .collect::<Vec<_>>()
        .join("||")
}

pub fn get_row_key(
    row: &StringRecord,
    header_map: &AHashMap<String, usize>,
    key_columns: &[String],
) -> String {
    key_columns.iter()
        .map(|k| {
            if let Some(&idx) = header_map.get(k) {
                row.get(idx).unwrap_or("")
            } else {
                ""
            }
        })
        .collect::<Vec<_>>()
        .join("|")
}

pub fn record_to_hashmap(
    row: &StringRecord,
    headers: &[String],
) -> HashMap<String, String> {
    headers.iter().enumerate()
        .map(|(i, h)| (h.clone(), row.get(i).unwrap_or("").to_string()))
        .collect()
}

/// Calculate string similarity using Jaro-Winkler algorithm.
/// Returns a value between 0.0 (completely different) and 1.0 (identical).
/// Best for short strings like names and identifiers.
pub fn similarity_jaro_winkler(s1: &str, s2: &str) -> f64 {
    jaro_winkler(s1, s2)
}

/// Calculate string similarity using normalized Levenshtein distance.
/// Returns a value between 0.0 (completely different) and 1.0 (identical).
/// Good for general-purpose string comparison.
pub fn similarity_levenshtein(s1: &str, s2: &str) -> f64 {
    normalized_levenshtein(s1, s2)
}

/// Calculate row similarity score using strsim algorithms.
/// Combines Jaro-Winkler for short fields and Levenshtein for longer text.
/// Returns a value between 0.0 and 1.0 where higher means more similar.
pub fn calculate_row_similarity(
    row1: &StringRecord,
    row2: &StringRecord,
    headers: &[String],
    header_map1: &AHashMap<String, usize>,
    header_map2: &AHashMap<String, usize>,
    excluded_columns: &[String],
) -> f64 {
    let mut total_similarity = 0.0;
    let mut compared_fields = 0;

    for header in headers {
        if excluded_columns.contains(header) {
            continue;
        }

        let idx1 = header_map1.get(header);
        let idx2 = header_map2.get(header);

        if let (Some(&i1), Some(&i2)) = (idx1, idx2) {
            let val1 = row1.get(i1).unwrap_or("");
            let val2 = row2.get(i2).unwrap_or("");

            // Use Jaro-Winkler for short strings (better for names, IDs)
            // Use Levenshtein for longer strings (better for descriptions)
            let similarity = if val1.len() <= 20 && val2.len() <= 20 {
                jaro_winkler(val1, val2)
            } else {
                normalized_levenshtein(val1, val2)
            };

            total_similarity += similarity;
            compared_fields += 1;
        }
    }

    if compared_fields > 0 {
        total_similarity / compared_fields as f64
    } else {
        0.0
    }
}
