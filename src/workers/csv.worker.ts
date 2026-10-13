import { bufferPool, cleanupWasm, initWasm } from "./wasm-context";
import { handleParse } from "./handlers/parse";
import { handleCompare } from "./handlers/compare";
import { createWorkerLogger } from "./worker-logger";
import { runRequest } from "./request-runner";
import type { WorkerRequest, WorkerResponse } from "./types";

let wasmInitialized = false;
const workerLog = createWorkerLogger("CSV Worker");

const post = (msg: WorkerResponse): void => {
  self.postMessage(msg);
};

const ensureWasm = async (): Promise<void> => {
  if (wasmInitialized) return;
  await initWasm();
  workerLog.success("WASM runtime ready", {
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
  wasmInitialized = true;
};

// Release WASM resources; later requests re-initialize on demand
const cleanup = (): void => {
  bufferPool.clear();
  cleanupWasm();
  wasmInitialized = false;
};

self.onmessage = async (event: MessageEvent): Promise<void> => {
  const message = event.data as WorkerRequest;

  if (message.type === "wasm_thread") {
    const { memory, module } = message.data;
    (self as any).wbg_rayon_start_worker(memory, module);
    return;
  }

  const { requestId, type, data } = message;
  try {
    await runRequest(
      { requestId, type, data },
      { post, ensureWasm, handleParse, handleCompare },
    );
  } catch (error: any) {
    // runRequest reports its own failures; this guards anything that escapes
    post({
      requestId,
      type: `${type}-error`,
      data: { message: error?.message ?? String(error), stack: error?.stack },
    });
  }
};

// Surface unhandled rejections instead of dropping them silently
self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const reason: unknown = event.reason;
  workerLog.error("Unhandled rejection in worker", {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// Cleanup on error
self.addEventListener("error", cleanup);

// Cleanup when worker is terminating
self.addEventListener("close", () => {
  workerLog.info("Worker terminating, cleaning up resources");
  cleanup();
});

// Also cleanup on page unload to prevent memory leaks
if (typeof self !== "undefined") {
  const originalClose = self.close;
  self.close = function () {
    cleanup();
    return originalClose.call(this);
  };
}
