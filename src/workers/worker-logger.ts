import type { WorkerLogPayload } from "./types";

type WorkerLogLevel = WorkerLogPayload["level"];

type WorkerLogger = {
  debug: (
    message: string,
    details?: WorkerLogPayload["details"],
    status?: WorkerLogPayload["status"],
  ) => void;
  info: (
    message: string,
    details?: WorkerLogPayload["details"],
    status?: WorkerLogPayload["status"],
  ) => void;
  success: (
    message: string,
    details?: WorkerLogPayload["details"],
    status?: WorkerLogPayload["status"],
  ) => void;
  warn: (
    message: string,
    details?: WorkerLogPayload["details"],
    status?: WorkerLogPayload["status"],
  ) => void;
  error: (
    message: string,
    details?: WorkerLogPayload["details"],
    status?: WorkerLogPayload["status"],
  ) => void;
};

const postWorkerLog = (entry: WorkerLogPayload): void => {
  if (typeof self === "undefined" || typeof self.postMessage !== "function") {
    return;
  }

  self.postMessage({
    type: "dev-log",
    data: {
      ...entry,
      timestamp: entry.timestamp ?? Date.now(),
    },
  });
};

const emit = (
  level: WorkerLogLevel,
  scope: string,
  message: string,
  details?: WorkerLogPayload["details"],
  status?: WorkerLogPayload["status"],
) => {
  postWorkerLog({ scope, message, level, details, status });
};

export const createWorkerLogger = (scope: string): WorkerLogger => ({
  debug: (message, details, status) =>
    emit("debug", scope, message, details, status),
  info: (message, details, status) =>
    emit("info", scope, message, details, status),
  success: (message, details, status) =>
    emit("success", scope, message, details, status),
  warn: (message, details, status) =>
    emit("warn", scope, message, details, status),
  error: (message, details, status) =>
    emit("error", scope, message, details, status),
});
