use std::collections::HashMap;
use std::borrow::Cow;
use csv::StringRecord;
use ahash::{AHashMap, AHashSet};
use strsim::{jaro_winkler, normalized_levenshtein};


pub fn is_empty_or_null(value: &str) -> bool {
    let v = value.trim();
    v.is_empty() || v.eq_ignore_ascii_case("null")
}

/// Normalize a value for comparison, returning a Cow to avoid allocations when possible.
/// This is critical for performance - only allocates when actual transformations are needed.
#[inline]
pub fn normalize_value_cow<'a>(
    value: &'a str, 
    case_sensitive: bool, 
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool
) -> Cow<'a, str> {
    let trimmed = if ignore_whitespace { value.trim() } else { value };
    
    // Check for empty/null first to short-circuit
    if ignore_empty_vs_null && is_empty_or_null(trimmed) {
        return Cow::Borrowed("EMPTY_OR_NULL");
    }
    
    // Only allocate if we actually need to lowercase
    if case_sensitive {
        if ignore_whitespace && trimmed.len() != value.len() {
            Cow::Owned(trimmed.to_string())
        } else {
            Cow::Borrowed(value)
        }
    } else {
        // Need to lowercase - must allocate
        Cow::Owned(trimmed.to_lowercase())
    }
}

pub fn normalize_value_with_empty_vs_null(
    value: &str, 
    case_sensitive: bool, 
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool
) -> String {
    normalize_value_cow(value, case_sensitive, ignore_whitespace, ignore_empty_vs_null).into_owned()
}

/// Build a fingerprint with pre-computed excluded columns set for O(1) lookup
#[inline]
pub fn get_row_fingerprint_fast(
    row: &StringRecord,
    headers: &[String],
    header_map: &AHashMap<String, usize>,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_set: &AHashSet<String>,
) -> String {
    let mut result = String::with_capacity(headers.len() * 16); // Pre-allocate estimated size
    let mut first = true;
    
    for h in headers {
        if excluded_set.contains(h) {
            continue;
        }
        
        if !first {
            result.push_str("||");
        }
        first = false;
        
        let val = if let Some(&idx) = header_map.get(h) {
            row.get(idx).unwrap_or("")
        } else {
            ""
        };
        
        let normalized = normalize_value_cow(val, case_sensitive, ignore_whitespace, ignore_empty_vs_null);
        result.push_str(&normalized);
    }
    
    result
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

/// Calculate row similarity score using strsim algorithms.
/// Combines Jaro-Winkler for short fields and Levenshtein for longer text.
/// Returns a value between 0.0 and 1.0 where higher means more similar.

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

pub fn similarity_jaro_winkler(a: &str, b: &str) -> f64 {
    jaro_winkler(a, b)
}

pub fn similarity_levenshtein(a: &str, b: &str) -> f64 {
    normalized_levenshtein(a, b)
}
