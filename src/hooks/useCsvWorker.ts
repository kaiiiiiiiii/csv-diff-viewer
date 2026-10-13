import { useCallback, useEffect, useRef } from "react";
import CsvWorker from "../workers/csv.worker?worker";
import { emitDevLog, emitPerformanceLog } from "@/lib/dev-logger";
import { metricsCollector } from "@/lib/performance-metrics";

interface WorkerRequest {
  id: number;
  resolve: (data: any) => void;
  reject: (error: any) => void;
  onProgress?: (percent: number, message: string) => void;
  startTime: number;
}

export function useCsvWorker() {
  const workerRef = useRef<Worker | null>(null);
  const requestMapRef = useRef<Map<number, WorkerRequest>>(new Map());
  const requestIdCounterRef = useRef(1);
  const warmPromiseRef = useRef<Promise<void> | null>(null);

  const send = useCallback(
    (id: number, type: string, data: unknown, reject: (e: Error) => void) => {
      const worker = workerRef.current;
      if (!worker) {
        requestMapRef.current.delete(id);
        reject(new Error("Worker is not available"));
        return;
      }
      try {
        worker.postMessage({ requestId: id, type, data });
      } catch (err) {
        requestMapRef.current.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [],
  );

  useEffect(() => {
    const worker = new CsvWorker();
    workerRef.current = worker;

    const rejectAllPending = (error: Error) => {
      const pending = Array.from(requestMapRef.current.values());
      requestMapRef.current.clear();
      warmPromiseRef.current = null;
      pending.forEach((request) => request.reject(error));
    };

    worker.onerror = (e: ErrorEvent) => {
      rejectAllPending(
        new Error(
          `Worker crashed: ${e.message || "unknown error"}${
            e.filename ? ` (${e.filename}:${e.lineno})` : ""
          }`,
        ),
      );
    };

    worker.onmessageerror = () => {
      rejectAllPending(
        new Error("Worker message could not be deserialized (messageerror)"),
      );
    };

    worker.onmessage = (e: MessageEvent) => {
      const { requestId, type, data } = e.data;
      // normalize operation name by removing -complete/-error suffix
      const opName = (type as string).replace(/-(complete|error)$/, "");
      const metrics = e.data?.metrics ?? data?.metrics;

      if (type === "dev-log") {
        emitDevLog(data);
        return;
      }

      const request = requestMapRef.current.get(requestId);

      if (!request) return;
      const elapsed = performance.now() - request.startTime;

      if (type === "progress") {
        request.onProgress?.(data.percent, data.message);
      } else if (
        type === "error" ||
        (typeof type === "string" && type.endsWith("-error"))
      ) {
        const message =
          data?.message ?? data ?? "Worker reported an unknown error";
        // Only emit a performance log for operation-specific errors like 'op-error'
        if (typeof type === "string" && type.endsWith("-error")) {
          try {
            emitPerformanceLog({
              operation: opName,
              duration: data?.duration ?? elapsed,
              status: "error",
              metrics,
              error: typeof message === "string" ? message : undefined,
            });
          } catch (err) {
            void err; // best-effort logging — ignore errors here to avoid breaking worker handling
          }
        }
        request.reject(new Error(message));
        requestMapRef.current.delete(requestId);
      } else if (type === "warm-wasm-complete" || type.endsWith("-complete")) {
        // Emit a performance log for success with optional metrics
        if (typeof type === "string" && type.endsWith("-complete")) {
          try {
            emitPerformanceLog({
              operation: opName,
              duration: data?.duration ?? elapsed,
              status: "success",
              metrics,
            });
          } catch (err) {
            void err; // ignore logging errors
          }
        }
        request.resolve(data);
        requestMapRef.current.delete(requestId);
      }
    };

    return () => {
      // Terminate worker, then fail all pending requests
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      workerRef.current = null;
      rejectAllPending(new Error("Worker terminated"));
    };
  }, []);

  const parse = useCallback(
    (
      csvText: string,
      name: string,
      hasHeaders: boolean,
      headersOnly?: boolean,
      withProgress?: boolean,
      onProgress?: (percent: number, message: string) => void,
    ) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++;
        const timerName = name.includes("source")
          ? "parseSourceTime"
          : "parseTargetTime";
        metricsCollector.startTimer(timerName);

        requestMapRef.current.set(id, {
          id,
          resolve: (data) => {
            metricsCollector.endTimer(timerName);
            resolve(data);
          },
          reject: (error) => {
            metricsCollector.endTimer(timerName);
            reject(error);
          },
          onProgress,
          startTime: performance.now(),
        });

        send(
          id,
          "parse",
          { csvText, name, hasHeaders, headersOnly, withProgress },
          reject,
        );
      });
    },
    [send],
  );

  const warmWasm = useCallback(() => {
    // Return existing promise if already warming
    if (warmPromiseRef.current) {
      return warmPromiseRef.current;
    }

    // Create new warm promise
    warmPromiseRef.current = new Promise<void>((resolve, reject) => {
      const id = requestIdCounterRef.current++;
      metricsCollector.startTimer("wasmInitTime");

      requestMapRef.current.set(id, {
        id,
        resolve: (data) => {
          metricsCollector.endTimer("wasmInitTime");
          resolve(data);
        },
        reject: (error) => {
          metricsCollector.endTimer("wasmInitTime");
          reject(error);
        },
        startTime: performance.now(),
      });

      send(id, "warm-wasm", {}, reject);
    });
    // Don't cache a failed warm-up forever
    const warm = warmPromiseRef.current;
    warm.catch(() => {
      if (warmPromiseRef.current === warm) warmPromiseRef.current = null;
    });

    return warmPromiseRef.current;
  }, [send]);

  const compare = useCallback(
    (
      // Kept for call-site compatibility; the worker reads the raw text from options
      _source: unknown,
      _target: unknown,
      options: any,
      onProgress?: (percent: number, message: string) => void,
    ) => {
      return new Promise((resolve, reject) => {
        const id = requestIdCounterRef.current++;
        metricsCollector.startTimer("compareTime");

        requestMapRef.current.set(id, {
          id,
          resolve: (data) => {
            metricsCollector.endTimer("compareTime");
            resolve(data);
          },
          reject: (error) => {
            metricsCollector.endTimer("compareTime");
            reject(error);
          },
          onProgress,
          startTime: performance.now(),
        });

        send(id, "compare", { ...options }, reject);
      });
    },
    [send],
  );

  return { parse, compare, warmWasm };
}
