import {
  diff_csv,
  diff_csv_binary,
  diff_csv_primary_key,
  diff_csv_primary_key_binary,
  diff_csv_primary_key_parallel,
  get_binary_result_capacity,
  get_binary_result_length,
} from "../../../src-wasm/pkg/csv_diff_wasm.js";
import { decodeBinaryResult } from "../../lib/binary-decoder";
import {
  USE_BINARY_ENCODING,
  USE_PARALLEL_PROCESSING,
  getWasmInstance,
  getWasmMemory,
} from "../wasm-context";
import { createWorkerLogger } from "../worker-logger";
import type {
  ComparePayload,
  PerformanceMetrics,
  ProgressCallback,
  WorkerResponse,
} from "../types";

const MAX_TRANSFERABLE_DEPTH = 10;
const compareLog = createWorkerLogger("Compare Handler");

export function handleCompare(
  requestId: number,
  payload: ComparePayload,
  postMessage: (msg: WorkerResponse, transfer?: Array<Transferable>) => void,
  emitProgress: ProgressCallback,
  currentMetrics: PerformanceMetrics | null,
) {
  const {
    comparisonMode,
    keyColumns,
    caseSensitive = false,
    ignoreWhitespace = false,
    ignoreEmptyVsNull = false,
    excludedColumns = [],
    sourceRaw,
    targetRaw,
    hasHeaders,
  } = payload;

  if (!sourceRaw || !targetRaw) {
    throw new Error("Raw CSV data is required for comparison.");
  }

  let results;
  const wasmMemory = getWasmMemory();
  const wasmInstance = getWasmInstance();

  if (USE_BINARY_ENCODING) {
    // Use high-performance binary encoding
    if (comparisonMode === "primary-key") {
      emitProgress(0, "Starting comparison (Primary Key, Binary)...");
      const resultPtr = diff_csv_primary_key_binary(
        sourceRaw,
        targetRaw,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders !== false,
        (percent: number, message: string) => emitProgress(percent, message),
      );

      // Decode binary result
      const resultLength = get_binary_result_length();
      const resultCapacity = get_binary_result_capacity();
      results = decodeBinaryResult(wasmMemory, resultPtr, resultLength);

      // Clean up WASM memory
      if (typeof wasmInstance?.dealloc === "function") {
        wasmInstance.dealloc(resultPtr, resultCapacity);
      }
      emitProgress(100, "Comparison complete");
    } else {
      emitProgress(0, "Starting comparison (Content Match, Binary)...");
      const resultPtr = diff_csv_binary(
        sourceRaw,
        targetRaw,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders !== false,
        (percent: number, message: string) => emitProgress(percent, message),
      );

      // Decode binary result
      const resultLength = get_binary_result_length();
      const resultCapacity = get_binary_result_capacity();
      results = decodeBinaryResult(wasmMemory, resultPtr, resultLength);

      // Clean up WASM memory
      if (typeof wasmInstance?.dealloc === "function") {
        wasmInstance.dealloc(resultPtr, resultCapacity);
      }
      emitProgress(100, "Comparison complete");
    }
  } else {
    // Use traditional JSON encoding (for debugging or compatibility)
    if (comparisonMode === "primary-key") {
      // Try parallel processing first if enabled
      if (USE_PARALLEL_PROCESSING) {
        try {
          emitProgress(0, "Starting comparison (Primary Key, Parallel)...");
          results = diff_csv_primary_key_parallel(
            sourceRaw,
            targetRaw,
            keyColumns,
            caseSensitive,
            ignoreWhitespace,
            ignoreEmptyVsNull,
            excludedColumns,
            hasHeaders !== false,
            (percent: number, message: string) =>
              emitProgress(percent, message),
          );
          emitProgress(100, "Comparison complete (Parallel)");
        } catch (error) {
          // Fallback to non-parallel if parallel fails
          compareLog.warn(
            "Parallel processing failed; falling back to single-threaded execution",
            {
              message: (error as Error).message,
              stack: (error as Error).stack,
            },
          );
          emitProgress(0, "Starting comparison (Primary Key)...");
          results = diff_csv_primary_key(
            sourceRaw,
            targetRaw,
            keyColumns,
            caseSensitive,
            ignoreWhitespace,
            ignoreEmptyVsNull,
            excludedColumns,
            hasHeaders !== false,
            false,
            (percent: number, message: string) =>
              emitProgress(percent, message),
          );
          emitProgress(100, "Comparison complete");
        }
      } else {
        emitProgress(0, "Starting comparison (Primary Key)...");
        results = diff_csv_primary_key(
          sourceRaw,
          targetRaw,
          keyColumns,
          caseSensitive,
          ignoreWhitespace,
          ignoreEmptyVsNull,
          excludedColumns,
          hasHeaders !== false,
          false,
          (percent: number, message: string) => emitProgress(percent, message),
        );
        emitProgress(100, "Comparison complete");
      }
    } else {
      emitProgress(0, "Starting comparison (Content Match)...");
      results = diff_csv(
        sourceRaw,
        targetRaw,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders !== false,
        (percent: number, message: string) => emitProgress(percent, message),
      );
      emitProgress(100, "Comparison complete");
    }
  }

  // Calculate performance metrics
  if (currentMetrics) {
    currentMetrics.totalTime = performance.now() - currentMetrics.startTime;
    currentMetrics.memoryUsed = wasmMemory.buffer.byteLength / 1024 / 1024; // MB
  }

  // Post results with performance metrics using Transferable ArrayBuffers
  const transferables: Array<Transferable> = [];

  // Extract any ArrayBuffer objects from the results for zero-copy transfer
  const seen = new WeakSet();
  const extractTransferables = (obj: any, depth = 0): void => {
    if (depth > MAX_TRANSFERABLE_DEPTH) return;

    if (obj instanceof ArrayBuffer) {
      transferables.push(obj);
    } else if (ArrayBuffer.isView(obj)) {
      transferables.push(obj.buffer);
    } else if (obj && typeof obj === "object") {
      // Skip if we've seen this object (circular reference)
      if (seen.has(obj)) return;
      seen.add(obj);

      Object.values(obj).forEach((val) => extractTransferables(val, depth + 1));
    }
  };

  extractTransferables(results);

  postMessage(
    {
      requestId,
      type: "compare-complete",
      data: results,
      metrics: currentMetrics || undefined,
    },
    transferables.length > 0 ? transferables : [],
  );
}
