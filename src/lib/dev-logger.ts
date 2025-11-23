import type { PerformanceMetrics } from "@/workers/types";

export type DevLogLevel = "debug" | "info" | "success" | "warn" | "error";

export interface DevLogEvent {
  scope: string;
  message: string;
  level?: DevLogLevel;
  status?: "pending" | "running" | "success" | "error" | "idle";
  details?:
    | Record<string, unknown>
    | Array<unknown>
    | string
    | number
    | boolean;
  requestId?: number;
  icon?: string;
  timestamp?: number;
}

export const DEV_LOG_EVENT = "dev-log";
export const PERFORMANCE_LOG_EVENT = "performance-log";

export interface PerformanceLogEvent {
  operation: string;
  duration: number;
  status: "success" | "error" | "running";
  metrics?: PerformanceMetrics;
  error?: string;
  timestamp?: number;
}

export const emitDevLog = (entry: DevLogEvent): void => {
  if (typeof window === "undefined") return;

  const detail = {
    ...entry,
    timestamp: entry.timestamp ?? Date.now(),
  } satisfies DevLogEvent;

  window.dispatchEvent(new CustomEvent(DEV_LOG_EVENT, { detail }));
};

export const emitPerformanceLog = (entry: PerformanceLogEvent): void => {
  if (typeof window === "undefined") return;

  const detail = {
    ...entry,
    timestamp: entry.timestamp ?? Date.now(),
  } satisfies PerformanceLogEvent;

  window.dispatchEvent(new CustomEvent(PERFORMANCE_LOG_EVENT, { detail }));
};

export const createScopedLogger = (scope: string) => {
  return {
    debug: (message: string, details?: DevLogEvent["details"]) =>
      emitDevLog({ scope, message, level: "debug", details }),
    info: (
      message: string,
      details?: DevLogEvent["details"],
      status?: DevLogEvent["status"],
    ) => emitDevLog({ scope, message, level: "info", details, status }),
    success: (message: string, details?: DevLogEvent["details"]) =>
      emitDevLog({ scope, message, level: "success", details }),
    warn: (message: string, details?: DevLogEvent["details"]) =>
      emitDevLog({ scope, message, level: "warn", details }),
    error: (
      message: string,
      details?: DevLogEvent["details"],
      status?: DevLogEvent["status"],
    ) => emitDevLog({ scope, message, level: "error", details, status }),
  };
};

export type ScopedLogger = ReturnType<typeof createScopedLogger>;
