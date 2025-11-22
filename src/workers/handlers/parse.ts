import { parse_csv } from "../../../src-wasm/pkg/csv_diff_wasm.js";
import type { ParsePayload, WorkerResponse } from "../types";

export function handleParse(
  requestId: number,
  payload: ParsePayload,
  postMessage: (msg: WorkerResponse) => void,
) {
  const { csvText, name, hasHeaders } = payload;

  // Note: parse_csv is imported directly from the pkg, but we could also use
  // getWasmInstance().parse_csv if we wanted to be consistent with dynamic loading.
  // However, since we're using the glue code, direct import is fine as long as
  // initWasm has been called (which sets up the wasm instance in the glue code).

  const result = parse_csv(csvText, hasHeaders !== false);

  postMessage({
    requestId,
    type: "parse-complete",
    data: { name, headers: result.headers, rows: result.rows },
  });
}
