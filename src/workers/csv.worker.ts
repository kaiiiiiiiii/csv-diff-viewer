import { bufferPool, initWasm } from "./wasm-context";
import { handleParse } from "./handlers/parse";
import { handleCompare } from "./handlers/compare";
import {
  handleCleanupDiffer,
  handleDiffChunk,
  handleInitDiffer,
} from "./handlers/chunked-diff";
import { createWorkerLogger } from "./worker-logger";
import type {
  ComparePayload,
  DiffChunkPayload,
  InitDifferPayload,
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
      case "parse":
        handleParse(requestId, data as ParsePayload, simplePostMessage);
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
      case "init-differ":
        handleInitDiffer(
          requestId,
          data as InitDifferPayload,
          simplePostMessage,
        );
        break;
      case "diff-chunk":
        handleDiffChunk(
          requestId,
          data as DiffChunkPayload,
          simplePostMessage,
          (percent: number, msg: string) =>
            postProgress(requestId, percent, msg),
        );
        break;
      case "cleanup-differ":
        handleCleanupDiffer(requestId, simplePostMessage);
        break;
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
self.addEventListener("error", () => bufferPool.clear());
