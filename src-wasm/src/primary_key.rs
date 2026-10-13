use crate::types::*;
use crate::utils::*;
use super::parse::parse_csv_streaming;
use ahash::{AHashMap, AHashSet};
use std::collections::hash_map::Entry;

pub fn diff_csv_primary_key_internal<F>(
    source_csv: &str,
    target_csv: &str,
    key_columns: Vec<String>,
    case_sensitive: bool,
    ignore_whitespace: bool,
    ignore_empty_vs_null: bool,
    excluded_columns: Vec<String>,
    has_headers: bool,
    mut on_progress: F,
) -> Result<DiffResult, Box<dyn std::error::Error>>
where
    F: FnMut(f64, &str),
{
    // Use streaming parser for better memory efficiency and progress reporting
    let (source_headers, source_rows, source_header_map) = parse_csv_streaming(
        source_csv, 
        has_headers, 
        5000,
        |percent, message| {
            on_progress(percent * 0.1, &format!("Source: {}", message)); // Scale to 0-10%
        }
    )?;

    let (target_headers, target_rows, target_header_map) = parse_csv_streaming(
        target_csv, 
        has_headers, 
        5000,
        |percent, message| {
            on_progress(10.0 + percent * 0.1, &format!("Target: {}", message)); // Scale to 10-20%
        }
    )?;

    // Validation of key columns
    if key_columns.is_empty() {
        return Err("At least one primary key column is required.".into());
    }
    for key in &key_columns {
        if !source_header_map.contains_key(key) {
             return Err(format!("Primary key column \"{}\" not found in source dataset.", key).into());
        }
        if !target_header_map.contains_key(key) {
             return Err(format!("Primary key column \"{}\" not found in target dataset.", key).into());
        }
    }

    let excluded_set: AHashSet<&str> = excluded_columns.iter().map(|s| s.as_str()).collect();

    on_progress(20.0, "Building source map...");
    let source_keys: Vec<String> = source_rows.iter()
        .map(|row| get_row_key(row, &source_header_map, &key_columns))
        .collect();
    let mut source_map: AHashMap<&str, usize> = AHashMap::with_capacity(source_keys.len());
    for (i, key) in source_keys.iter().enumerate() {
        match source_map.entry(key.as_str()) {
            Entry::Occupied(_) => {
                return Err(format!("Duplicate Primary Key found in source: \"{}\". Primary Keys must be unique.", key.replace(KEY_SEP, ", ")).into());
            }
            Entry::Vacant(v) => { v.insert(i); }
        }
    }

    on_progress(40.0, "Building target map...");
    let target_keys: Vec<String> = target_rows.iter()
        .map(|row| get_row_key(row, &target_header_map, &key_columns))
        .collect();
    let mut target_map: AHashMap<&str, usize> = AHashMap::with_capacity(target_keys.len());
    for (i, key) in target_keys.iter().enumerate() {
        match target_map.entry(key.as_str()) {
            Entry::Occupied(_) => {
                return Err(format!("Duplicate Primary Key found in target: \"{}\". Primary Keys must be unique.", key.replace(KEY_SEP, ", ")).into());
            }
            Entry::Vacant(v) => { v.insert(i); }
        }
    }

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();

    on_progress(60.0, "Comparing rows...");

    // Find removed (in source row order)
    for (row_idx, key) in source_keys.iter().enumerate() {
        if !target_map.contains_key(key.as_str()) {
            removed.push(RemovedRow {
                key: key.clone(),
                source_row: record_to_hashmap(&source_rows[row_idx], &source_headers),
            });
        }
    }

    // Find added, modified and unchanged (in target row order)
    let total_target = target_keys.len();
    for (target_row_idx, key) in target_keys.iter().enumerate() {
        if target_row_idx % 1000 == 0 {
             let p = 60.0 + (target_row_idx as f64 / total_target as f64) * 30.0;
             on_progress(p, "Comparing rows...");
        }

        let target_row = &target_rows[target_row_idx];

        match source_map.get(key.as_str()) {
            None => {
                added.push(AddedRow {
                    key: key.clone(),
                    target_row: record_to_hashmap(target_row, &target_headers),
                });
            }
            Some(&source_row_idx) => {
                let source_row = &source_rows[source_row_idx];
                let mut differences = Vec::new();
                
                for header in &source_headers {
                    if excluded_set.contains(header.as_str()) {
                        continue;
                    }
                    
                    let source_idx = source_header_map.get(header).unwrap();
                    let target_idx = match target_header_map.get(header) {
                        Some(idx) => idx,
                        None => continue, 
                    };

                    let source_val_raw = source_row.get(*source_idx).unwrap_or("");
                    let target_val_raw = target_row.get(*target_idx).unwrap_or("");

                    let source_val = normalize_value_cow(
                        source_val_raw,
                        case_sensitive,
                        ignore_whitespace,
                        ignore_empty_vs_null
                    );
                    let target_val = normalize_value_cow(
                        target_val_raw,
                        case_sensitive,
                        ignore_whitespace,
                        ignore_empty_vs_null
                    );

                    if source_val != target_val {
                        let diffs = crate::core::diff_text_internal(source_val_raw, target_val_raw, case_sensitive);

                        differences.push(Difference {
                            column: header.clone(),
                            old_value: source_val_raw.to_string(),
                            new_value: target_val_raw.to_string(),
                            diff: diffs,
                        });
                    }
                }

                if !differences.is_empty() {
                    modified.push(ModifiedRow {
                        key: key.clone(),
                        source_row: record_to_hashmap(source_row, &source_headers),
                        target_row: record_to_hashmap(target_row, &target_headers),
                        differences,
                    });
                } else {
                    unchanged.push(UnchangedRow {
                        key: key.clone(),
                        row: record_to_hashmap(source_row, &source_headers),
                    });
                }
            }
        }
    }

    on_progress(100.0, "Comparison complete");

    Ok(DiffResult {
        added,
        removed,
        modified,
        unchanged,
        source: DatasetMetadata { headers: source_headers, rows: Vec::new() },
        target: DatasetMetadata { headers: target_headers, rows: Vec::new() },
        key_columns,
        excluded_columns,
        mode: "primary-key".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(src: &str, tgt: &str, keys: &[&str], excluded: &[&str], case_sensitive: bool) -> Result<DiffResult, Box<dyn std::error::Error>> {
        diff_csv_primary_key_internal(
            src,
            tgt,
            keys.iter().map(|s| s.to_string()).collect(),
            case_sensitive,
            false,
            false,
            excluded.iter().map(|s| s.to_string()).collect(),
            true,
            |_, _| {},
        )
    }

    fn keys<T>(rows: &[T], f: impl Fn(&T) -> &str) -> Vec<String> {
        rows.iter().map(|r| f(r).to_string()).collect()
    }

    #[test]
    fn output_is_deterministic_and_row_ordered() {
        let mut src = String::from("id,v\n");
        let mut tgt = String::from("id,v\n");
        for i in 0..200 {
            src.push_str(&format!("{},a\n", i));
            // odd ids modified, multiples of 10 removed, plus new ids
            if i % 10 != 0 {
                tgt.push_str(&format!("{},{}\n", i, if i % 2 == 1 { "b" } else { "a" }));
            }
        }
        for i in 200..230 {
            tgt.push_str(&format!("{},n\n", i));
        }
        let r1 = run(&src, &tgt, &["id"], &[], true).unwrap();
        let r2 = run(&src, &tgt, &["id"], &[], true).unwrap();
        assert_eq!(keys(&r1.added, |r| &r.key), keys(&r2.added, |r| &r.key));
        assert_eq!(keys(&r1.removed, |r| &r.key), keys(&r2.removed, |r| &r.key));
        assert_eq!(keys(&r1.modified, |r| &r.key), keys(&r2.modified, |r| &r.key));
        assert_eq!(keys(&r1.unchanged, |r| &r.key), keys(&r2.unchanged, |r| &r.key));
        assert_eq!(keys(&r1.removed, |r| &r.key)[..3], ["0", "10", "20"]);
        assert_eq!(keys(&r1.added, |r| &r.key)[0], "200");
        assert_eq!(keys(&r1.modified, |r| &r.key)[..3], ["1", "3", "5"]);
        assert_eq!(r1.unchanged.len(), 80);
        assert_eq!(r1.modified.len(), 100);
        assert!(r1.source.rows.is_empty());
    }

    #[test]
    fn duplicate_keys_error() {
        let err = run("id,v\n1,a\n1,b\n", "id,v\n1,a\n", &["id"], &[], true).err().unwrap();
        assert!(err.to_string().contains("Duplicate Primary Key found in source"));
        let err = run("id,v\n1,a\n", "id,v\n2,a\n2,b\n", &["id"], &[], true).err().unwrap();
        assert!(err.to_string().contains("Duplicate Primary Key found in target"));
    }

    #[test]
    fn empty_key_list_errors() {
        let err = run("id,v\n1,a\n", "id,v\n1,a\n", &[], &[], true).err().unwrap();
        assert!(err.to_string().contains("primary key column is required"));
    }

    #[test]
    fn composite_keys_with_separator_chars_do_not_collide() {
        let src = "a,b,v\na|b,c,1\na,b|c,2\n";
        let tgt = "a,b,v\na|b,c,1\na,b|c,2\n";
        let r = run(src, tgt, &["a", "b"], &[], true).unwrap();
        assert_eq!(r.unchanged.len(), 2);
        assert!(r.added.is_empty() && r.removed.is_empty() && r.modified.is_empty());
    }

    #[test]
    fn excluded_columns_are_ignored() {
        let r = run("id,v,ts\n1,a,x\n", "id,v,ts\n1,a,y\n", &["id"], &["ts"], true).unwrap();
        assert_eq!(r.unchanged.len(), 1);
        assert!(r.modified.is_empty());
        let r = run("id,v,ts\n1,a,x\n", "id,v,ts\n1,a,y\n", &["id"], &[], true).unwrap();
        assert_eq!(r.modified.len(), 1);
    }
}
