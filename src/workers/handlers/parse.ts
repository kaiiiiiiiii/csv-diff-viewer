import {
  parse_csv_headers_only,
  parse_csv_with_progress,
} from "../../../src-wasm/pkg/csv_diff_wasm.js";
import type { ParsePayload, WorkerResponse } from "../types";

export function handleParse(
  requestId: number,
  payload: ParsePayload,
  postMessage: (msg: WorkerResponse) => void,
) {
  const { csvText, name, hasHeaders, headersOnly = false } = payload;

  // Note: parse_csv is imported directly from the pkg, but we could also use
  // getWasmInstance().parse_csv if we wanted to be consistent with dynamic loading.
  // However, since we're using the glue code, direct import is fine as long as
  // initWasm has been called (which sets up the wasm instance in the glue code).

  const postProgress = (percent: number, message: string) => {
    postMessage({
      requestId,
      type: "progress",
      data: { percent, message },
    });
  };

  // Always use streaming parser for better performance and memory efficiency
  // The streaming parser now handles both headers-only and full parsing with progress
  const result = headersOnly
    ? parse_csv_headers_only(csvText, hasHeaders !== false)
    : parse_csv_with_progress(csvText, hasHeaders !== false, postProgress);

  postMessage({
    requestId,
    type: "parse-complete",
    data: { name, headers: result.headers, rows: result.rows, headersOnly },
  });
}
