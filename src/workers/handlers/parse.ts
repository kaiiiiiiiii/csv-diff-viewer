import {
  parse_csv_headers_only,
  parse_csv_with_progress,
} from "../../../src-wasm/pkg/csv_diff_wasm.js";
import { throttleProgress } from "../progress";
import type { ParsePayload, WorkerResponse } from "../types";

export function handleParse(
  requestId: number,
  payload: ParsePayload,
  postMessage: (msg: WorkerResponse) => void,
) {
  const { csvText, name, hasHeaders, headersOnly = false } = payload;

  // parse_csv_headers_only / parse_csv_with_progress are imported straight from
  // the wasm-bindgen glue, which is ready once initWasm has run.

  const postProgress = (percent: number, message: string) => {
    postMessage({
      requestId,
      type: "progress",
      data: { percent, message },
    });
  };

  // Headers-only skips row parsing; the full parse reports progress
  const result = headersOnly
    ? parse_csv_headers_only(csvText, hasHeaders !== false)
    : parse_csv_with_progress(
        csvText,
        hasHeaders !== false,
        throttleProgress(postProgress),
      );

  postMessage({
    requestId,
    type: "parse-complete",
    data: { name, headers: result.headers, rows: result.rows, headersOnly },
  });
}
