import { bufferPool, cleanupWasm, initWasm } from "./wasm-context";
import { handleParse } from "./handlers/parse";
import { handleCompare } from "./handlers/compare";
import { createWorkerLogger } from "./worker-logger";
import type {
  ComparePayload,
  ParsePayload,
  PerformanceMetrics,
  WorkerRequest,
  WorkerResponse,
} from "./types";

let wasmInitialized = false;
let workerQueue: Array<{ requestId: number; type: string; timestamp: number }> =
  [];
const workerLog = createWorkerLogger("CSV Worker");

const postProgress = (
  requestId: number,
  percent: number,
  message: string,
): void => {
  self.postMessage({
    requestId,
    type: "progress",
    data: { percent, message },
  } as WorkerResponse);
};

const simplePostMessage = (msg: WorkerResponse): void => {
  self.postMessage(msg);
};

const transferablePostMessage = (
  msg: WorkerResponse,
  transferables?: Array<Transferable>,
): void => {
  (self.postMessage as any)(msg, transferables ?? []);
};

self.onmessage = async (event: MessageEvent): Promise<void> => {
  const message = event.data as WorkerRequest;

  if (message.type === "wasm_thread") {
    const { memory, module } = message.data;
    (self as any).wbg_rayon_start_worker(memory, module);
    return;
  }

  const { requestId, type, data } = message;

  // Update queue status
  workerQueue.push({ requestId, type, timestamp: Date.now() });

  // Emit worker status
  self.postMessage({
    type: "dev-log",
    data: {
      scope: "Worker Pool",
      message: `Processing ${type} request`,
      level: "info",
      status: "running",
      details: { requestId, type, queueLength: workerQueue.length },
    },
  });

  try {
    if (!wasmInitialized) {
      await initWasm();
      workerLog.success("WASM runtime ready", {
        crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        hardwareConcurrency: navigator.hardwareConcurrency,
      });
      wasmInitialized = true;
    }

    switch (type) {
      case "warm-wasm":
        // WASM is already initialized in the try block above
        workerLog.success("WASM pre-warmed successfully");
        self.postMessage({
          requestId,
          type: "warm-wasm-complete",
          data: { success: true },
        } as WorkerResponse);
        break;
      case "parse":
        handleParse(requestId, data as ParsePayload, (msg) => {
          if (msg.type === "progress") {
            postProgress(requestId, msg.data.percent, msg.data.message);
          } else {
            simplePostMessage(msg);
          }
        });
        break;
      case "compare": {
        const metrics: PerformanceMetrics = { startTime: performance.now() };
        handleCompare(
          requestId,
          data as ComparePayload,
          transferablePostMessage,
          (percent: number, msg: string) =>
            postProgress(requestId, percent, msg),
          metrics,
        );
        break;
      }
      default:
        throw new Error(`Unknown request type: ${type}`);
    }
  } catch (error: any) {
    const errMessage = error?.message ?? String(error);
    const stack = error?.stack ?? undefined;
    // Log error for worker-level visibility
    workerLog.error("Worker request failed", {
      requestId,
      type,
      message: errMessage,
      stack,
    });

    // Update queue status on error
    workerQueue = workerQueue.filter((item) => item.requestId !== requestId);

    self.postMessage({
      type: "dev-log",
      data: {
        scope: "Worker Pool",
        message: `Error processing ${type} request`,
        level: "error",
        status: "error",
        details: {
          requestId,
          type,
          queueLength: workerQueue.length,
          error: errMessage,
        },
      },
    });

    // Send structured error payload to the main thread (message + stack)
    simplePostMessage({
      requestId,
      type: `${type}-error`,
      data: { message: errMessage, stack },
    } as WorkerResponse);
  } finally {
    // Clean up queue on completion (success or error)
    workerQueue = workerQueue.filter((item) => item.requestId !== requestId);

    if (workerQueue.length === 0) {
      self.postMessage({
        type: "dev-log",
        data: {
          scope: "Worker Pool",
          message: "All requests completed",
          level: "info",
          status: "idle",
          details: { queueLength: 0 },
        },
      });
    }
  }
};

// Cleanup on error
self.addEventListener("error", () => {
  bufferPool.clear();
  cleanupWasm();
});

// Cleanup when worker is terminating
self.addEventListener("close", () => {
  workerLog.info("Worker terminating, cleaning up resources");
  bufferPool.clear();
  cleanupWasm();
});

// Also cleanup on page unload to prevent memory leaks
if (typeof self !== "undefined") {
  const originalClose = self.close;
  self.close = function () {
    bufferPool.clear();
    cleanupWasm();
    return originalClose.call(this);
  };
}
