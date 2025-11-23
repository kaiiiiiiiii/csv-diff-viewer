import { bufferPool, initWasm } from "./wasm-context";
import { init_thread_pool } from "../../src-wasm/pkg/csv_diff_wasm.js";
import { handleParse } from "./handlers/parse";
import { handleCompare } from "./handlers/compare";
import {
  handleCleanupDiffer,
  handleDiffChunk,
  handleInitDiffer,
} from "./handlers/chunked-diff";
import type {
  ComparePayload,
  DiffChunkPayload,
  InitDifferPayload,
  ParsePayload,
  PerformanceMetrics,
  ProgressCallback,
  WorkerRequest,
  WorkerResponse,
} from "./types";

let wasmInitialized = false;

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
  const { requestId, type, data }: WorkerRequest = event.data;

  try {
    if (!wasmInitialized) {
      await initWasm();
      init_thread_pool(navigator.hardwareConcurrency);
      console.log("Cross-origin isolated:", crossOriginIsolated);
      console.log(
        "SharedArrayBuffer available:",
        typeof SharedArrayBuffer !== "undefined",
      );
      console.log(
        "Thread pool ready with",
        navigator.hardwareConcurrency,
        "threads",
      );
      wasmInitialized = true;
    }

    switch (type) {
      case "parse":
        handleParse(requestId, data as ParsePayload, simplePostMessage);
        break;
      case "compare":
        const metrics: PerformanceMetrics = { startTime: performance.now() };
        handleCompare(
          requestId,
          data as ComparePayload,
          transferablePostMessage,
          (percent: number, message: string) =>
            postProgress(requestId, percent, message),
          metrics,
        );
        break;
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
          (percent: number, message: string) =>
            postProgress(requestId, percent, message),
        );
        break;
      case "cleanup-differ":
        handleCleanupDiffer(requestId, simplePostMessage);
        break;
      default:
        throw new Error(`Unknown request type: ${type}`);
    }
  } catch (error: any) {
    simplePostMessage({
      requestId,
      type: `${type}-error`,
      error: error.message ?? String(error),
    });
  }
};

// Cleanup on error
self.addEventListener("error", () => bufferPool.clear());
