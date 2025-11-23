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

  // Log invocation with small context (do not log raw CSV content)
  compareLog.info("Compare handler invoked", {
    requestId,
    comparisonMode,
    useBinaryEncoding: USE_BINARY_ENCODING,
    useParallelProcessing: USE_PARALLEL_PROCESSING,
    sourceSize: sourceRaw.length,
    targetSize: targetRaw.length,
    hasHeaders,
    keyColumnCount: keyColumns?.length ?? 0,
    excludedColumnCount: excludedColumns.length,
  });

  if (!sourceRaw || !targetRaw) {
    // Validate inputs early and throw; the outer try/catch will handle posting and logging
    throw new Error("Raw CSV data is required for comparison.");
  }

  let results;
  const wasmMemory = getWasmMemory();
  const wasmInstance = getWasmInstance();
  const releaseBinaryBuffer = (ptr: number, capacity: number): void => {
    if (!ptr || !capacity) return;
    const deallocFn = (wasmInstance as { dealloc?: (p: number, size: number) => void }).dealloc;
    if (typeof deallocFn === "function") {
      deallocFn(ptr, capacity);
    } else {
      compareLog.warn("WASM dealloc function unavailable; skipping buffer release", {
        requestId,
      });
    }
  };

  try {
    if (USE_BINARY_ENCODING) {
      // Use high-performance binary encoding
      if (comparisonMode === "primary-key") {
        compareLog.debug("Calling WASM method", {
          method: "diff_csv_primary_key_binary",
          requestId,
        });
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

        // Log counts
        compareLog.info("Decoded binary diff counts", {
          requestId,
          added: results.added.length,
          removed: results.removed.length,
          modified: results.modified.length,
          unchanged: results.unchanged.length,
        });

        // Clean up WASM memory
        releaseBinaryBuffer(resultPtr, resultCapacity);
        emitProgress(100, "Comparison complete");
      } else {
        compareLog.debug("Calling WASM method", {
          method: "diff_csv_binary",
          requestId,
        });
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
        compareLog.info("Decoded binary diff counts", {
          requestId,
          added: Array.isArray(results.added) ? results.added.length : null,
          removed: Array.isArray(results.removed)
            ? results.removed.length
            : null,
          modified: Array.isArray(results.modified)
            ? results.modified.length
            : null,
          unchanged: Array.isArray(results.unchanged)
            ? results.unchanged.length
            : null,
        });

        // Clean up WASM memory
        releaseBinaryBuffer(resultPtr, resultCapacity);
        emitProgress(100, "Comparison complete");
      }
    } else {
      // Use traditional JSON encoding (for debugging or compatibility)
      if (comparisonMode === "primary-key") {
        // Try parallel processing first if enabled
        if (USE_PARALLEL_PROCESSING) {
          try {
            compareLog.debug("Calling WASM method", {
              method: "diff_csv_primary_key_parallel",
              requestId,
            });
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
            compareLog.debug("Calling WASM method", {
              method: "diff_csv_primary_key",
              requestId,
            });
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
          compareLog.debug("Calling WASM method", {
            method: "diff_csv_primary_key",
            requestId,
          });
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
        compareLog.debug("Calling WASM method", {
          method: "diff_csv",
          requestId,
        });
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

    // Make sure we have results
    if (results === undefined || results === null) {
      const msg = "Comparison did not return any results";
      compareLog.error("No results from compare", { requestId, message: msg });
      postMessage({
        requestId,
        type: "compare-error",
        data: { message: msg },
        metrics: currentMetrics || undefined,
      });
      return;
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

        Object.values(obj).forEach((val) =>
          extractTransferables(val, depth + 1),
        );
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

    // Log success after postMessage completes
    try {
      const counts = {
        added: Array.isArray(results.added) ? results.added.length : null,
        removed: Array.isArray(results.removed) ? results.removed.length : null,
        modified: Array.isArray(results.modified)
          ? results.modified.length
          : null,
        unchanged: Array.isArray(results.unchanged)
          ? results.unchanged.length
          : null,
      };

      compareLog.success("Compare complete", {
        requestId,
        counts,
        transferred: transferables.length,
        metrics: currentMetrics ?? undefined,
      });
    } catch (logErr) {
      // Avoid breaking the worker when logging fails
      compareLog.warn("Failed to emit compare success log", {
        requestId,
        message: (logErr as Error).message,
      });
    }
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const stack = err?.stack ?? undefined;
    compareLog.error("Compare handler threw an exception", {
      requestId,
      message,
      stack,
    });
    postMessage({
      requestId,
      type: "compare-error",
      data: { message, stack },
      metrics: currentMetrics || undefined,
    });
    return;
  }
}
