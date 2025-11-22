import { CsvDiffer } from "../../../src-wasm/pkg/csv_diff_wasm.js";
import type {
  DiffChunkPayload,
  InitDifferPayload,
  ProgressCallback,
  WorkerResponse,
} from "../types";

let differ: CsvDiffer | null = null;

export function handleInitDiffer(
  requestId: number,
  payload: InitDifferPayload,
  postMessage: (msg: WorkerResponse) => void,
): void {
  // Free previous differ if exists
  if (differ) {
    differ.free();
    differ = null;
  }

  const {
    sourceRaw,
    targetRaw,
    comparisonMode,
    keyColumns = [],
    caseSensitive = false,
    ignoreWhitespace = false,
    ignoreEmptyVsNull = false,
    excludedColumns = [],
    hasHeaders,
  } = payload;

  differ = new CsvDiffer(
    sourceRaw,
    targetRaw,
    comparisonMode,
    keyColumns,
    caseSensitive,
    ignoreWhitespace,
    ignoreEmptyVsNull,
    excludedColumns,
    hasHeaders !== false,
  );

  postMessage({
    requestId,
    type: "init-differ-complete",
    data: { success: true },
  });
}

export function handleDiffChunk(
  requestId: number,
  payload: DiffChunkPayload,
  postMessage: (msg: WorkerResponse) => void,
  emitProgress: ProgressCallback,
): any {
  if (!differ) {
    throw new Error("Differ not initialized");
  }

  const { chunkStart, chunkSize } = payload;

  const results = differ.diff_chunk(chunkStart, chunkSize, emitProgress);

  postMessage({
    requestId,
    type: "diff-chunk-complete",
    data: results,
  });

  return results;
}

export function handleCleanupDiffer(
  requestId: number,
  postMessage: (msg: WorkerResponse) => void,
): void {
  if (differ) {
    differ.free();
    differ = null;
  }

  postMessage({
    requestId,
    type: "cleanup-differ-complete",
    data: { success: true },
  });
}

export function freeDiffer(): void {
  if (differ) {
    differ.free();
    differ = null;
  }
}
