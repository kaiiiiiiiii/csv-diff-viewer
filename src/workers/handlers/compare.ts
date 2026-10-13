import { shouldFallbackToSequential, toFatalError } from "../fallback";
import {
  diff_csv_binary,
  diff_csv_parallel_binary,
  diff_csv_primary_key_binary,
  diff_csv_primary_key_parallel_binary,
  get_binary_result_capacity,
  get_binary_result_length,
} from "../../../src-wasm/pkg/csv_diff_wasm.js";
import { decodeBinaryResult } from "../../lib/binary-decoder";
import {
  USE_PARALLEL_PROCESSING,
  canUseThreads,
  getWasmInstance,
  getWasmMemory,
} from "../wasm-context";
import { createWorkerLogger } from "../worker-logger";
import { countRows, parseThreadProgress, throttleProgress } from "../progress";
import type {
  ComparePayload,
  PerformanceMetrics,
  ProgressCallback,
  WorkerLogPayload,
  WorkerResponse,
} from "../types";

type ThreadStatus = NonNullable<WorkerLogPayload["details"]> & {
  status: "idle" | "running" | "completed" | "error";
};

const compareLog = createWorkerLogger("Compare Handler");

// Emit thread status to main thread
const emitThreadStatus = (
  threadId: number,
  status: ThreadStatus["status"],
  currentTask?: string,
  progress?: number,
  itemsProcessed?: number,
  totalItems?: number,
) => {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    self.postMessage({
      type: "dev-log",
      data: {
        scope: "Worker Threads",
        message: `Thread ${threadId}: ${status}${currentTask ? ` - ${currentTask}` : ""}`,
        level: status === "error" ? "error" : "info",
        details: { threadId, status, progress, itemsProcessed, totalItems },
      },
    });
  }
};

/**
 * Build the progress callback handed to the parallel WASM exports. THREAD_PROGRESS
 * messages become per-thread status updates; everything else is a global update.
 * Both are throttled so a chunk-heavy diff does not flood the main thread.
 */
const createParallelProgress = (
  emitProgress: ProgressCallback,
  task: string,
): ProgressCallback => {
  const globalProgress = throttleProgress(emitProgress);
  const lastThreadEmit = new Map<number, number>();
  return (percent, message) => {
    const thread = parseThreadProgress(message);
    if (!thread) {
      globalProgress(percent, message);
      return;
    }
    const now = performance.now();
    const last = lastThreadEmit.get(thread.threadId) ?? -Infinity;
    if (now - last < 50) return;
    lastThreadEmit.set(thread.threadId, now);
    emitThreadStatus(
      thread.threadId,
      "running",
      task,
      thread.globalProgress ?? percent,
      thread.processed,
      thread.perThreadTotal,
    );
  };
};

const getThreadCount = (): number =>
  Math.max(
    1,
    (typeof navigator !== "undefined"
      ? navigator.hardwareConcurrency || 4
      : 4) - 1,
  );

export function handleCompare(
  requestId: number,
  payload: ComparePayload,
  postMessage: (msg: WorkerResponse, transfer?: Array<Transferable>) => void,
  emitProgress: ProgressCallback,
  currentMetrics: PerformanceMetrics | null,
) {
  try {
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

    // Estimated row counts (excluding headers if present), used for progress only
    const totalRowCount = Math.max(
      countRows(sourceRaw, hasHeaders !== false),
      countRows(targetRaw, hasHeaders !== false),
    );

    // Log invocation with small context (do not log raw CSV content)
    compareLog.info("Compare handler invoked", {
      requestId,
      comparisonMode,
      useParallelProcessing: USE_PARALLEL_PROCESSING,
      sourceSize: sourceRaw.length,
      targetSize: targetRaw.length,
      hasHeaders,
      keyColumnCount: keyColumns?.length ?? 0,
      excludedColumnCount: excludedColumns.length,
    });

    const wasmMemory = getWasmMemory();
    const wasmInstance = getWasmInstance();
    const releaseBinaryBuffer = (ptr: number, capacity: number): void => {
      if (!ptr || !capacity) return;
      const deallocFn = (
        wasmInstance as { dealloc?: (p: number, size: number) => void }
      ).dealloc;
      if (typeof deallocFn === "function") {
        deallocFn(ptr, capacity);
      } else {
        compareLog.warn(
          "WASM dealloc function unavailable; skipping buffer release",
          { requestId },
        );
      }
    };

    // Decode the binary result held at ptr, then free the WASM buffer
    const decodeAndRelease = (ptr: number) => {
      const length = get_binary_result_length();
      const capacity = get_binary_result_capacity();
      try {
        return decodeBinaryResult(wasmMemory, ptr, length);
      } finally {
        releaseBinaryBuffer(ptr, capacity);
      }
    };

    const progress = throttleProgress(emitProgress);
    const sequentialProgress = (percent: number, message: string) =>
      progress(percent, message);

    // Run a parallel export with per-thread status; returns the decoded result
    const runParallel = (
      task: string,
      call: (onProgress: ProgressCallback) => number,
    ) => {
      const numThreads = getThreadCount();
      const perThreadTotal = Math.ceil(totalRowCount / numThreads);
      for (let i = 0; i < numThreads; i++) {
        emitThreadStatus(i, "running", task, 0, 0, perThreadTotal);
      }
      let ok = false;
      try {
        const ptr = call(createParallelProgress(emitProgress, task));
        const decoded = decodeAndRelease(ptr);
        ok = true;
        return decoded;
      } finally {
        for (let i = 0; i < numThreads; i++) {
          if (ok) emitThreadStatus(i, "completed", "Comparison complete");
          else emitThreadStatus(i, "error", "Parallel comparison failed");
        }
      }
    };

    let results;

    if (comparisonMode === "primary-key") {
      const runSequential = () => {
        compareLog.debug("Calling WASM method", {
          method: "diff_csv_primary_key_binary",
          requestId,
        });
        emitProgress(0, "Starting comparison (Primary Key, Binary)...");
        return decodeAndRelease(
          diff_csv_primary_key_binary(
            sourceRaw,
            targetRaw,
            keyColumns,
            caseSensitive,
            ignoreWhitespace,
            ignoreEmptyVsNull,
            excludedColumns,
            hasHeaders !== false,
            sequentialProgress,
          ),
        );
      };

      if (canUseThreads()) {
        try {
          compareLog.debug("Calling WASM method", {
            method: "diff_csv_primary_key_parallel_binary",
            requestId,
          });
          emitProgress(0, "Starting comparison (Primary Key, Parallel)...");
          results = runParallel("Parallel Primary Key", (onProgress) =>
            diff_csv_primary_key_parallel_binary(
              sourceRaw,
              targetRaw,
              keyColumns,
              caseSensitive,
              ignoreWhitespace,
              ignoreEmptyVsNull,
              excludedColumns,
              hasHeaders !== false,
              onProgress,
            ),
          );
        } catch (error) {
          if (!shouldFallbackToSequential(error)) throw toFatalError(error);
          compareLog.warn(
            "Parallel processing failed; falling back to single-threaded binary execution",
            {
              message: (error as Error).message,
              stack: (error as Error).stack,
            },
          );
          results = runSequential();
        }
      } else {
        results = runSequential();
      }
    } else {
      const runSequential = () => {
        compareLog.debug("Calling WASM method", {
          method: "diff_csv_binary",
          requestId,
        });
        emitProgress(0, "Starting comparison (Content Match, Binary)...");
        return decodeAndRelease(
          diff_csv_binary(
            sourceRaw,
            targetRaw,
            caseSensitive,
            ignoreWhitespace,
            ignoreEmptyVsNull,
            excludedColumns,
            hasHeaders !== false,
            sequentialProgress,
          ),
        );
      };

      if (canUseThreads()) {
        try {
          compareLog.debug("Calling WASM method", {
            method: "diff_csv_parallel_binary",
            requestId,
          });
          emitProgress(0, "Starting comparison (Content Match, Parallel)...");
          results = runParallel("Parallel Content Match", (onProgress) =>
            diff_csv_parallel_binary(
              sourceRaw,
              targetRaw,
              caseSensitive,
              ignoreWhitespace,
              ignoreEmptyVsNull,
              excludedColumns,
              hasHeaders !== false,
              onProgress,
            ),
          );
        } catch (error) {
          if (!shouldFallbackToSequential(error)) throw toFatalError(error);
          compareLog.warn(
            "Parallel processing failed; falling back to single-threaded binary execution",
            {
              message: (error as Error).message,
              stack: (error as Error).stack,
            },
          );
          results = runSequential();
        }
      } else {
        results = runSequential();
      }
    }

    emitProgress(100, "Comparison complete");

    // Calculate performance metrics
    if (currentMetrics) {
      currentMetrics.totalTime = performance.now() - currentMetrics.startTime;
      currentMetrics.memoryUsed = wasmMemory.buffer.byteLength / 1024 / 1024; // MB
    }

    // The decoder yields a plain object (strings/arrays), so nothing to transfer
    postMessage({
      requestId,
      type: "compare-complete",
      data: results,
      metrics: currentMetrics || undefined,
    });

    compareLog.success("Compare complete", {
      requestId,
      counts: {
        added: results.added.length,
        removed: results.removed.length,
        modified: results.modified.length,
        unchanged: results.unchanged.length,
      },
      metrics: currentMetrics ?? undefined,
    });
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
  }
}
