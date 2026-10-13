import { createWorkerLogger } from "./worker-logger";
import type {
  ComparePayload,
  ParsePayload,
  PerformanceMetrics,
  WorkerResponse,
} from "./types";

export interface RunnerRequest {
  requestId: number;
  type: string;
  data: unknown;
}

export interface RunnerDeps {
  post: (msg: WorkerResponse) => void;
  ensureWasm: () => Promise<void>;
  handleParse: (
    requestId: number,
    payload: ParsePayload,
    post: (msg: WorkerResponse) => void,
  ) => void | Promise<void>;
  handleCompare: (
    requestId: number,
    payload: ComparePayload,
    post: (msg: WorkerResponse) => void,
    emitProgress: (percent: number, message: string) => void,
    metrics: PerformanceMetrics,
  ) => void | Promise<void>;
}

let workerQueue: Array<{ requestId: number; type: string; timestamp: number }> =
  [];
const workerLog = createWorkerLogger("CSV Worker");

const postProgress = (
  post: RunnerDeps["post"],
  requestId: number,
  percent: number,
  message: string,
): void => {
  post({ requestId, type: "progress", data: { percent, message } });
};

const postPoolLog = (
  post: RunnerDeps["post"],
  data: Record<string, unknown>,
): void => {
  post({ type: "dev-log", data: { scope: "Worker Pool", ...data } });
};

/**
 * Run one parse/compare/warm-wasm request. Never throws: any failure (including
 * from async handlers) is posted as `<type>-error` for the request id.
 */
export async function runRequest(
  { requestId, type, data }: RunnerRequest,
  deps: RunnerDeps,
): Promise<void> {
  const { post } = deps;

  // Update queue status
  workerQueue.push({ requestId, type, timestamp: Date.now() });

  postPoolLog(post, {
    message: `Processing ${type} request`,
    level: "info",
    status: "running",
    details: { requestId, type, queueLength: workerQueue.length },
  });

  try {
    await deps.ensureWasm();

    switch (type) {
      case "warm-wasm":
        workerLog.success("WASM pre-warmed successfully");
        post({
          requestId,
          type: "warm-wasm-complete",
          data: { success: true },
        });
        break;
      case "parse":
        await deps.handleParse(requestId, data as ParsePayload, (msg) => {
          if (msg.type === "progress") {
            postProgress(post, requestId, msg.data.percent, msg.data.message);
          } else {
            post(msg);
          }
        });
        break;
      case "compare": {
        const metrics: PerformanceMetrics = { startTime: performance.now() };
        await deps.handleCompare(
          requestId,
          data as ComparePayload,
          post,
          (percent: number, msg: string) =>
            postProgress(post, requestId, percent, msg),
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
    workerLog.error("Worker request failed", {
      requestId,
      type,
      message: errMessage,
      stack,
    });

    // Update queue status on error
    workerQueue = workerQueue.filter((item) => item.requestId !== requestId);

    postPoolLog(post, {
      message: `Error processing ${type} request`,
      level: "error",
      status: "error",
      details: {
        requestId,
        type,
        queueLength: workerQueue.length,
        error: errMessage,
      },
    });

    // Send structured error payload to the main thread (message + stack)
    post({
      requestId,
      type: `${type}-error`,
      data: { message: errMessage, stack },
    });
  } finally {
    // Clean up queue on completion (success or error), after async work finished
    workerQueue = workerQueue.filter((item) => item.requestId !== requestId);

    if (workerQueue.length === 0) {
      postPoolLog(post, {
        message: "All requests completed",
        level: "info",
        status: "idle",
        details: { queueLength: 0 },
      });
    }
  }
}
