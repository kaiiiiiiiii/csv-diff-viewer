import Papa from "papaparse";

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, any>[];
}

export function parseCSV(
  csvText: string,
  hasHeaders: boolean = true
): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    // First pass to determine structure
    Papa.parse(csvText, {
      header: hasHeaders,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn("CSV Parsing errors:", results.errors);
        }

        if (hasHeaders) {
          resolve({
            headers: results.meta.fields || [],
            rows: results.data as Record<string, any>[],
          });
        } else {
          // If no headers, we need to manually generate headers and convert arrays to objects
          // PapaParse with header: false returns arrays
          Papa.parse(csvText, {
            header: false,
            skipEmptyLines: true,
            complete: (resultsNoHeader) => {
              const data = resultsNoHeader.data as string[][];
              if (!data || data.length === 0) {
                resolve({ headers: [], rows: [] });
                return;
              }

              const colCount = data[0].length;
              const headers = Array.from(
                { length: colCount },
                (_, i) => `Column${i + 1}`
              );

              const rows = data.map((rowArray) => {
                const rowObj: Record<string, any> = {};
                headers.forEach((header, index) => {
                  rowObj[header] =
                    rowArray[index] !== undefined ? rowArray[index] : "";
                });
                return rowObj;
              });
              resolve({ headers, rows });
            },
            error: (err: Error) => reject(err),
          });
        }
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
}
