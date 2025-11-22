import init, {
  CsvDiffer,
  diff_csv,
  diff_csv_primary_key,
  diff_csv_binary,
  diff_csv_primary_key_binary,
  diff_csv_primary_key_parallel,
  get_binary_result_length,
  get_streaming_config,
  init_parallel_processing,
  dealloc,
  parse_csv,
} from "../../src-wasm/pkg/csv_diff_wasm";
import { decodeBinaryResult } from "../lib/binary-decoder";

const ctx: Worker = self as any;
let wasmInitialized = false;
let differ: CsvDiffer | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

// Configuration flags for performance optimizations
const USE_BINARY_ENCODING = true;  // Enable binary encoding for faster data transfer
const USE_PARALLEL_PROCESSING = true;  // Enable multi-threaded processing with rayon
const USE_TRANSFERABLES = true;  // Enable transferable ArrayBuffers for zero-copy transfer

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

async function initWasm() {
  if (!wasmInitialized) {
    const wasmExports = await init();
    // Access memory from the initialized WASM module
    // The init() function returns the wasm exports which includes memory
    wasmMemory = wasmExports.memory;
    wasmInitialized = true;
    
    // Initialize parallel processing if enabled
    if (USE_PARALLEL_PROCESSING) {
      try {
        // Use hardware concurrency if available, otherwise default to 4 threads
        const numThreads = (navigator.hardwareConcurrency || 4) - 1; // Reserve 1 for main thread
        init_parallel_processing(Math.max(1, numThreads));
        console.log(`[CSV Worker] Initialized parallel processing with ${numThreads} threads`);
      } catch (error) {
        console.warn('[CSV Worker] Failed to initialize parallel processing:', error);
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
            (percent: number, message: string) => emitProgress(percent, message),
          );
          
          // Decode binary result
          const resultLength = get_binary_result_length();
          if (!wasmMemory) {
            throw new Error("WASM memory not initialized");
          }
          results = decodeBinaryResult(wasmMemory, resultPtr, resultLength);
          
          // Clean up WASM memory
          dealloc(resultPtr, resultLength);
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
          if (!wasmMemory) {
            throw new Error("WASM memory not initialized");
          }
          results = decodeBinaryResult(wasmMemory, resultPtr, resultLength);
          
          // Clean up WASM memory
          dealloc(resultPtr, resultLength);
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
                (percent: number, message: string) => emitProgress(percent, message),
              );
              emitProgress(100, "Comparison complete (Parallel)");
            } catch (error) {
              // Fallback to non-parallel if parallel fails
              console.warn('[CSV Worker] Parallel processing failed, falling back to single-threaded:', error);
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
                (percent: number, message: string) => emitProgress(percent, message),
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
        currentMetrics.memoryUsed = (wasmMemory?.buffer.byteLength ?? 0) / 1024 / 1024; // MB
      }

      // Post results with performance metrics using Transferable ArrayBuffers
      // Check if results contain ArrayBuffers that can be transferred
      const transferables: Transferable[] = [];
      
      // Extract any ArrayBuffer objects from the results for zero-copy transfer
      const extractTransferables = (obj: any): void => {
        if (obj instanceof ArrayBuffer) {
          transferables.push(obj);
        } else if (ArrayBuffer.isView(obj)) {
          transferables.push(obj.buffer);
        } else if (obj && typeof obj === 'object') {
          Object.values(obj).forEach(extractTransferables);
        }
      };
      
      extractTransferables(results);
      
      // Use transferable ArrayBuffers for zero-copy data transfer
      ctx.postMessage(
        { 
          requestId, 
          type: "compare-complete", 
          data: results,
          metrics: currentMetrics 
        },
        transferables.length > 0 ? transferables : undefined
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
    
    console.error('[CSV Worker Error]', errorContext);
    
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
ctx.addEventListener('close', () => {
  bufferPool.clear();
  if (differ) {
    differ.free();
  }
});
