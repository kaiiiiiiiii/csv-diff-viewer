import init, {
  CsvDiffer,
  diff_csv,
  diff_csv_primary_key,
  diff_csv_binary,
  diff_csv_primary_key_binary,
  diff_csv_primary_key_parallel,
  get_binary_result_length,
  get_binary_result_capacity,
  init_thread_pool,
  init_panic_hook,
  dealloc,
  parse_csv,
} from "../../src-wasm/pkg/csv_diff_wasm";
import { decodeBinaryResult } from "../lib/binary-decoder";

const ctx: Worker = self as any;
let wasmInitialized = false;
let differ: CsvDiffer | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

// Configuration flags for performance optimizations
const USE_BINARY_ENCODING = true; // Enable binary encoding for faster data transfer
const USE_PARALLEL_PROCESSING = true; // Enable multi-threaded processing with rayon

// Thread pool configuration
const DEFAULT_THREAD_COUNT = 4; // Fallback if hardwareConcurrency unavailable
const RESERVED_THREADS = 1; // Reserve threads for main thread and UI
const MAX_TRANSFERABLE_DEPTH = 10; // Limit recursion depth for transferable extraction

// Performance monitoring and profiling
interface PerformanceMetrics {
  startTime: number;
  parseTime?: number;
  diffTime?: number;
  serializeTime?: number;
  totalTime?: number;
  memoryUsed?: number;
}

let currentMetrics: PerformanceMetrics | null = null;

// Buffer pool for WASM allocations to reduce malloc/free overhead
class BufferPool {
  private pools: Map<number, number[]> = new Map();
  private readonly maxPoolSize = 10;

  get(size: number): number | null {
    const pool = this.pools.get(size);
    return pool?.pop() ?? null;
  }

  put(size: number, ptr: number): void {
    if (!this.pools.has(size)) {
      this.pools.set(size, []);
    }
    const pool = this.pools.get(size)!;
    if (pool.length < this.maxPoolSize) {
      pool.push(ptr);
    } else {
      // Pool is full, deallocate
      dealloc(ptr, size);
    }
  }

  clear(): void {
    for (const [size, ptrs] of this.pools) {
      for (const ptr of ptrs) {
        dealloc(ptr, size);
      }
    }
    this.pools.clear();
  }
}

const bufferPool = new BufferPool();

// Check for SharedArrayBuffer support
if (!self.crossOriginIsolated) {
  console.warn(
    "[CSV Worker] crossOriginIsolated is false. SharedArrayBuffer will not work. " +
      "Ensure COOP/COEP headers are set correctly in vite.config.ts.",
  );
}

async function initWasm() {
  if (!wasmInitialized) {
    const wasmExports = await init();
    // Access memory from the initialized WASM module
    // The init() function returns the wasm exports which includes memory
    wasmMemory = wasmExports.memory;
    wasmInitialized = true;
    // Debugging: log if memory buffer is backed by SharedArrayBuffer and whether we have isolation
    try {
      const buffer = wasmMemory?.buffer;
      const isShared =
        typeof SharedArrayBuffer !== "undefined" &&
        buffer instanceof SharedArrayBuffer;
      console.log(
        `[CSV Worker] WASM memory buffer type: ${isShared ? "SharedArrayBuffer" : "ArrayBuffer"}, crossOriginIsolated: ${self.crossOriginIsolated}`,
      );
    } catch (e) {
      console.warn(
        "[CSV Worker] Could not determine WASM memory buffer type",
        e,
      );
    }

    // Initialize panic hook for better error messages
    try {
      init_panic_hook();
    } catch (e) {
      console.warn("[CSV Worker] Failed to initialize panic hook:", e);
    }

    // Initialize parallel processing if enabled
    if (USE_PARALLEL_PROCESSING) {
      try {
        if (!self.crossOriginIsolated) {
          throw new Error("crossOriginIsolated is false, cannot use threads");
        }

        // Ensure the WASM memory is backed by a SharedArrayBuffer so it can be cloned/transferred.
        // If not, it means the runtime isn't enabling shared memory for the wasm build and
        // wasm-bindgen-rayon cannot start workers. Bail early to avoid a DataCloneError.
        const memBuffer = wasmMemory?.buffer as any as
          | ArrayBuffer
          | SharedArrayBuffer
          | undefined;
        const isSharedBuffer =
          typeof SharedArrayBuffer !== "undefined" &&
          memBuffer instanceof SharedArrayBuffer;
        if (!isSharedBuffer) {
          throw new Error(
            "WASM memory buffer is not a SharedArrayBuffer; threads cannot be started",
          );
        }

        // Use hardware concurrency if available, otherwise use default
        const numThreads = Math.max(
          1,
          (navigator.hardwareConcurrency || DEFAULT_THREAD_COUNT) -
            RESERVED_THREADS,
        );

        console.log(
          `[CSV Worker] Initializing thread pool with ${numThreads} threads...`,
        );

        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Thread pool initialization timed out")),
            3000,
          );
        });

        // Race initialization against timeout
        await Promise.race([init_thread_pool(numThreads), timeoutPromise]);

        console.log(
          `[CSV Worker] Thread pool initialized with ${numThreads} threads`,
        );
      } catch (error: any) {
        console.warn(
          "[CSV Worker] Thread pool initialization timed out/failed, falling back to single-threaded mode:",
          error,
        );
        // Provide an additional hint for DataCloneError which usually indicates
        // that SharedArrayBuffer is not enabled or that wasm memory is not shared.
        try {
          const msg = (error?.message as string) || "";
          if (
            msg.includes("could not be cloned") ||
            msg.includes("DataCloneError")
          ) {
            console.warn(
              "[CSV Worker] DataCloneError detected — this usually means WebAssembly memory couldn't be posted to a Worker.\n" +
                "Ensure your server sets COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp)\n" +
                "and that the wasm module and worker files are served from the same origin with Cross-Origin-Resource-Policy.",
            );
          }
        } catch {
          // ignore
        }
      }
    }
  }
}

ctx.onmessage = async function (e) {
  const { requestId, type, data } = e.data || {};

  if (!requestId) {
    ctx.postMessage({
      requestId: 0,
      type: "error",
      data: { message: "Worker request missing requestId." },
    });
    return;
  }

  // Start performance tracking
  currentMetrics = { startTime: performance.now() };

  const emitProgress = (progress: number, message: string) => {
    ctx.postMessage({
      requestId,
      type: "progress",
      data: {
        percent: progress,
        message: message,
      },
    });
  };

  try {
    await initWasm();

    if (type === "parse") {
      const { csvText, name, hasHeaders } = data;
      const result = parse_csv(csvText, hasHeaders !== false);
      ctx.postMessage({
        requestId,
        type: "parse-complete",
        data: { name, headers: result.headers, rows: result.rows },
      });
    } else if (type === "compare") {
      const {
        comparisonMode,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        sourceRaw,
        targetRaw,
        hasHeaders,
      } = data;

      if (!sourceRaw || !targetRaw) {
        throw new Error("Raw CSV data is required for comparison.");
      }

      let results;
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
            (percent: number, message: string) =>
              emitProgress(percent, message),
          );

          // Decode binary result
          const resultLength = get_binary_result_length();
          const resultCapacity = get_binary_result_capacity();
          if (!wasmMemory) {
            throw new Error("WASM memory not initialized");
          }
          results = decodeBinaryResult(wasmMemory, resultPtr, resultLength);

          // Clean up WASM memory
          dealloc(resultPtr, resultCapacity);
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
            (percent: number, message: string) =>
              emitProgress(percent, message),
          );

          // Decode binary result
          const resultLength = get_binary_result_length();
          const resultCapacity = get_binary_result_capacity();
          if (!wasmMemory) {
            throw new Error("WASM memory not initialized");
          }
          results = decodeBinaryResult(wasmMemory, resultPtr, resultLength);

          // Clean up WASM memory
          dealloc(resultPtr, resultCapacity);
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
              console.warn(
                "[CSV Worker] Parallel processing failed, falling back to single-threaded:",
                error,
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
              (percent: number, message: string) =>
                emitProgress(percent, message),
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
            (percent: number, message: string) =>
              emitProgress(percent, message),
          );
          emitProgress(100, "Comparison complete");
        }
      }

      // Calculate performance metrics
      if (currentMetrics) {
        currentMetrics.totalTime = performance.now() - currentMetrics.startTime;
        currentMetrics.memoryUsed =
          (wasmMemory?.buffer.byteLength ?? 0) / 1024 / 1024; // MB
      }

      // Post results with performance metrics using Transferable ArrayBuffers
      // Check if results contain ArrayBuffers that can be transferred
      const transferables: Transferable[] = [];

      // Extract any ArrayBuffer objects from the results for zero-copy transfer
      // Use depth limiting and circular reference detection to prevent stack overflow
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

      // Use transferable ArrayBuffers for zero-copy data transfer
      ctx.postMessage(
        {
          requestId,
          type: "compare-complete",
          data: results,
          metrics: currentMetrics,
        },
        transferables.length > 0 ? transferables : [],
      );
    } else if (type === "init-differ") {
      const {
        sourceRaw,
        targetRaw,
        comparisonMode,
        keyColumns,
        caseSensitive,
        ignoreWhitespace,
        ignoreEmptyVsNull,
        excludedColumns,
        hasHeaders,
      } = data;

      if (differ) {
        differ.free();
        differ = null;
      }

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

      ctx.postMessage({
        requestId,
        type: "init-differ-complete",
        data: { success: true },
      });
    } else if (type === "diff-chunk") {
      const { chunkStart, chunkSize } = data;

      if (!differ) {
        throw new Error("Differ not initialized");
      }

      const results = differ.diff_chunk(
        chunkStart,
        chunkSize,
        (percent: number, message: string) => emitProgress(percent, message),
      );

      ctx.postMessage({
        requestId,
        type: "diff-chunk-complete",
        data: results,
      });
    } else if (type === "cleanup-differ") {
      if (differ) {
        differ.free();
        differ = null;
      }
      ctx.postMessage({
        requestId,
        type: "cleanup-differ-complete",
        data: { success: true },
      });
    }
  } catch (error: any) {
    // Enhanced error logging with context
    const errorContext = {
      message: error.message,
      stack: error.stack,
      type: type,
      timestamp: new Date().toISOString(),
      metrics: currentMetrics,
      wasmMemorySize: wasmMemory?.buffer.byteLength,
    };

    console.error("[CSV Worker Error]", errorContext);

    ctx.postMessage({
      requestId,
      type: "error",
      data: errorContext,
    });
  } finally {
    // Reset metrics for next operation
    currentMetrics = null;
  }
};

// Cleanup on worker termination
ctx.addEventListener("close", () => {
  bufferPool.clear();
  if (differ) {
    differ.free();
  }
});
