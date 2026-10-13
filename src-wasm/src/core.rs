pub use crate::parse::parse_csv_internal;
pub use crate::primary_key::diff_csv_primary_key_internal;
pub use crate::content_match::diff_csv_internal;

use similar::{capture_diff_slices, Algorithm, DiffOp};
use crate::types::*;

// Parsing and diff functions moved to dedicated modules: parse.rs, primary_key.rs, content_match.rs

// Primary key diff function moved to `primary_key.rs` and re-exported above

// Content-match diff function moved to `content_match.rs` and re-exported above

/// Split into alternating runs of whitespace / non-whitespace (same granularity as word diffing).
fn split_words(text: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut prev_ws: Option<bool> = None;
    for (i, ch) in text.char_indices() {
        let ws = ch.is_whitespace();
        if let Some(p) = prev_ws {
            if p != ws {
                tokens.push(&text[start..i]);
                start = i;
            }
        }
        prev_ws = Some(ws);
    }
    if start < text.len() {
        tokens.push(&text[start..]);
    }
    tokens
}

pub fn diff_text_internal(old: &str, new: &str, case_sensitive: bool) -> Vec<DiffChange> {
    let old_tokens = split_words(old);
    let new_tokens = split_words(new);

    // Compare on normalized keys but emit the original token text
    let ops = if case_sensitive {
        capture_diff_slices(Algorithm::Myers, &old_tokens, &new_tokens)
    } else {
        let old_keys: Vec<String> = old_tokens.iter().map(|t| t.to_lowercase()).collect();
        let new_keys: Vec<String> = new_tokens.iter().map(|t| t.to_lowercase()).collect();
        capture_diff_slices(Algorithm::Myers, &old_keys, &new_keys)
    };

    let mut changes = Vec::new();
    let mut push = |added: bool, removed: bool, value: &str| {
        changes.push(DiffChange { added, removed, value: value.to_string() });
    };

    for op in ops {
        match op {
            DiffOp::Equal { old_index, len, .. } => {
                for t in &old_tokens[old_index..old_index + len] {
                    push(false, false, t);
                }
            }
            DiffOp::Delete { old_index, old_len, .. } => {
                for t in &old_tokens[old_index..old_index + old_len] {
                    push(false, true, t);
                }
            }
            DiffOp::Insert { new_index, new_len, .. } => {
                for t in &new_tokens[new_index..new_index + new_len] {
                    push(true, false, t);
                }
            }
            DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                for t in &old_tokens[old_index..old_index + old_len] {
                    push(false, true, t);
                }
                for t in &new_tokens[new_index..new_index + new_len] {
                    push(true, false, t);
                }
            }
        }
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(diffs: &[DiffChange], added: bool, removed: bool) -> String {
        diffs.iter().filter(|d| d.added == added && d.removed == removed).map(|d| d.value.as_str()).collect()
    }

    #[test]
    fn case_insensitive_keeps_original_casing() {
        let d = diff_text_internal("Hello World", "HELLO Universe", false);
        assert_eq!(joined(&d, false, false), "Hello ");
        assert_eq!(joined(&d, false, true), "World");
        assert_eq!(joined(&d, true, false), "Universe");
    }

    #[test]
    fn case_insensitive_identical_apart_from_case_is_all_equal() {
        let d = diff_text_internal("Hello World", "hello world", false);
        assert!(d.iter().all(|c| !c.added && !c.removed));
        assert_eq!(joined(&d, false, false), "Hello World");
    }

    #[test]
    fn case_sensitive_reports_case_change() {
        let d = diff_text_internal("Hello", "hello", true);
        assert!(d.iter().any(|c| c.removed && c.value == "Hello"));
        assert!(d.iter().any(|c| c.added && c.value == "hello"));
    }
}
