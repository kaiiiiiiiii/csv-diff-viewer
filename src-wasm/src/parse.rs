use csv::ReaderBuilder;
use csv::StringRecord;
use ahash::AHashMap;

type ParseResult = Result<(Vec<String>, Vec<StringRecord>, AHashMap<String, usize>), Box<dyn std::error::Error>>;

/// Strip a leading UTF-8 byte order mark so it doesn't end up in the first header/cell
fn strip_bom(csv_content: &str) -> &str {
    csv_content.strip_prefix('\u{feff}').unwrap_or(csv_content)
}

/// Check if the "headers" look like data (purely numeric values). Blank cells never count.
fn headers_look_like_data(headers: &StringRecord, first_row: &StringRecord) -> bool {
    headers.len() == first_row.len() &&
        headers.iter().any(|h| {
            let trimmed = h.trim();
            !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit())
        })
}

fn generated_headers(col_count: usize) -> Vec<String> {
    (0..col_count).map(|i| format!("Column{}", i + 1)).collect()
}

fn build_header_map(headers: &[String]) -> AHashMap<String, usize> {
    headers.iter().enumerate().map(|(i, h)| (h.clone(), i)).collect()
}

pub fn parse_csv_internal(
    csv_content: &str,
    has_headers: bool,
) -> ParseResult {
    parse_csv_impl(csv_content, has_headers, usize::MAX, |_, _| {})
}

/// Streaming CSV parser that emits progress and processes in chunks
pub fn parse_csv_streaming<F>(
    csv_content: &str,
    has_headers: bool,
    chunk_size: usize,
    mut on_progress: F,
) -> ParseResult
where
    F: FnMut(f64, &str),
{
    on_progress(0.0, "Initializing CSV reader...");
    let result = parse_csv_impl(csv_content, has_headers, chunk_size.max(1), &mut on_progress)?;
    on_progress(100.0, "CSV parsing complete");
    Ok(result)
}

/// Single-pass parser shared by the internal and streaming entry points.
/// Records are read without a header row so the first record can be reclassified
/// as data when the header auto-detect says it is.
fn parse_csv_impl<F>(
    csv_content: &str,
    has_headers: bool,
    chunk_size: usize,
    mut on_progress: F,
) -> ParseResult
where
    F: FnMut(f64, &str),
{
    let csv_content = strip_bom(csv_content);
    let total_bytes = csv_content.len().max(1) as f64;

    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .trim(csv::Trim::All)
        .from_reader(csv_content.as_bytes());

    let mut records = rdr.records();
    let mut rows: Vec<StringRecord> = Vec::new();

    let first = match records.next() {
        Some(record) => record?,
        None => return Ok((vec![], vec![], AHashMap::new())),
    };

    let headers: Vec<String> = if has_headers {
        match records.next() {
            Some(second) => {
                let second = second?;
                if headers_look_like_data(&first, &second) {
                    // Headers are actually data - keep the first row and generate names
                    let names = generated_headers(first.len());
                    rows.push(first);
                    rows.push(second);
                    names
                } else {
                    let names = first.iter().map(|s| s.to_string()).collect();
                    rows.push(second);
                    names
                }
            }
            None => first.iter().map(|s| s.to_string()).collect(),
        }
    } else {
        let names = generated_headers(first.len());
        rows.push(first);
        names
    };

    on_progress(5.0, "Reading CSV data in chunks...");

    let mut processed = rows.len();
    let mut next_report = chunk_size;
    while let Some(record) = records.next() {
        rows.push(record?);
        processed += 1;

        if processed >= next_report {
            next_report = next_report.saturating_add(chunk_size);
            let progress = (records.reader().position().byte() as f64 / total_bytes) * 90.0 + 5.0; // 5-95%
            on_progress(progress.min(95.0), &format!("Processed {} rows", processed));
        }
    }

    let header_map = build_header_map(&headers);
    Ok((headers, rows, header_map))
}

/// Read only the header and up to `n` data rows without parsing the whole file.
/// Applies the same BOM stripping and header auto-detect as the full parsers.
pub fn parse_headers_sample(
    csv_content: &str,
    has_headers: bool,
    n: usize,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let csv_content = strip_bom(csv_content);

    let mut rdr = ReaderBuilder::new()
        .has_headers(false)
        .trim(csv::Trim::All)
        .from_reader(csv_content.as_bytes());

    let to_strings = |record: &StringRecord| -> Vec<String> {
        record.iter().map(|s| s.to_string()).collect()
    };

    let mut records = rdr.records();
    let first = match records.next() {
        Some(record) => record.map_err(|e| e.to_string())?,
        None => return Ok((vec![], vec![])),
    };

    let mut rows: Vec<Vec<String>> = Vec::new();
    let headers: Vec<String> = if has_headers {
        // Always peek one data row so auto-detect can run, even when n == 0
        let second = match records.next() {
            Some(record) => Some(record.map_err(|e| e.to_string())?),
            None => None,
        };
        match second {
            Some(second) if headers_look_like_data(&first, &second) => {
                rows.push(to_strings(&first));
                rows.push(to_strings(&second));
                generated_headers(first.len())
            }
            Some(second) => {
                rows.push(to_strings(&second));
                to_strings(&first)
            }
            None => to_strings(&first),
        }
    } else {
        rows.push(to_strings(&first));
        generated_headers(first.len())
    };

    while rows.len() < n {
        match records.next() {
            Some(record) => rows.push(to_strings(&record.map_err(|e| e.to_string())?)),
            None => break,
        }
    }
    rows.truncate(n);

    Ok((headers, rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cells(rows: &[StringRecord]) -> Vec<Vec<String>> {
        rows.iter().map(|r| r.iter().map(|s| s.to_string()).collect()).collect()
    }

    fn streaming(csv: &str, has_headers: bool) -> (Vec<String>, Vec<StringRecord>, AHashMap<String, usize>) {
        parse_csv_streaming(csv, has_headers, 2, |_, _| {}).unwrap()
    }

    #[test]
    fn streaming_keeps_first_data_row_with_headers() {
        let (headers, rows, map) = streaming("id,name\nA,x\nB,y\nC,z\n", true);
        assert_eq!(headers, vec!["id", "name"]);
        assert_eq!(rows.len(), 3);
        assert_eq!(&rows[0][0], "A");
        assert_eq!(map["name"], 1);
    }

    #[test]
    fn streaming_keeps_first_row_headerless() {
        let (headers, rows, _) = streaming("A,x\nB,y\nC,z\n", false);
        assert_eq!(headers, vec!["Column1", "Column2"]);
        assert_eq!(rows.len(), 3);
        assert_eq!(&rows[0][0], "A");
    }

    #[test]
    fn numeric_header_treated_as_data() {
        let (headers, rows, _) = streaming("1,2,3\n4,5,6\n", true);
        assert_eq!(headers, vec!["Column1", "Column2", "Column3"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(&rows[0][0], "1");
    }

    #[test]
    fn row_count_equals_input_rows() {
        let csv: String = std::iter::once("id,v\n".to_string())
            .chain((0..1000).map(|i| format!("k{},{}\n", i, i)))
            .collect();
        assert_eq!(streaming(&csv, true).1.len(), 1000);
        assert_eq!(parse_csv_internal(&csv, true).unwrap().1.len(), 1000);
    }

    #[test]
    fn bom_is_stripped() {
        let csv = "\u{feff}id,name\n1,a\n";
        assert_eq!(parse_csv_internal(csv, true).unwrap().0, vec!["id", "name"]);
        assert_eq!(streaming(csv, true).0, vec!["id", "name"]);
        let (headers, rows) = parse_headers_sample(csv, true, 5).unwrap();
        assert_eq!(headers, vec!["id", "name"]);
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn blank_header_cell_is_not_numeric() {
        let (headers, rows, _) = parse_csv_internal(",name\nx,y\n", true).unwrap();
        assert_eq!(headers, vec!["", "name"]);
        assert_eq!(rows.len(), 1);
        let (headers, rows, _) = streaming(",name\nx,y\n", true);
        assert_eq!(headers, vec!["", "name"]);
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn quoted_field_with_newline() {
        let csv = "id,note\n1,\"line one\nline two\"\n2,plain\n";
        let (_, rows, _) = streaming(csv, true);
        assert_eq!(rows.len(), 2);
        assert_eq!(&rows[0][1], "line one\nline two");
    }

    #[test]
    fn headers_sample_limits_rows() {
        let (headers, rows) = parse_headers_sample("id,name\nA,x\nB,y\nC,z\n", true, 2).unwrap();
        assert_eq!(headers, vec!["id", "name"]);
        assert_eq!(rows, vec![vec!["A", "x"], vec!["B", "y"]]);
        let (_, rows) = parse_headers_sample("id,name\nA,x\n", true, 0).unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn headers_sample_headerless_keeps_first_row() {
        let (headers, rows) = parse_headers_sample("A,x\nB,y\nC,z\n", false, 2).unwrap();
        assert_eq!(headers, vec!["Column1", "Column2"]);
        assert_eq!(rows, vec![vec!["A", "x"], vec!["B", "y"]]);

        let (headers, rows) = parse_headers_sample("1,2\n3,4\n5,6\n", true, 5).unwrap();
        assert_eq!(headers, vec!["Column1", "Column2"]);
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn headers_sample_empty_input() {
        assert_eq!(parse_headers_sample("", true, 3).unwrap(), (vec![], vec![]));
    }

    #[test]
    fn streaming_matches_internal() {
        let inputs = [
            "id,name\nA,x\nB,y\nC,z\n",
            "1,2,3\n4,5,6\n",
            "\u{feff}a,b\n\"q\nr\",2\n",
            "only,header\n",
            "",
        ];
        for csv in inputs {
            for has_headers in [true, false] {
                let (h1, r1, m1) = parse_csv_internal(csv, has_headers).unwrap();
                let (h2, r2, m2) = streaming(csv, has_headers);
                assert_eq!(h1, h2, "headers differ for {:?}", csv);
                assert_eq!(cells(&r1), cells(&r2), "rows differ for {:?}", csv);
                assert_eq!(m1.len(), m2.len());
            }
        }
    }
}
