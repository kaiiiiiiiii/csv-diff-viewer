import { useCallback, useEffect, useRef } from "react";
import CsvWorker from "../workers/csv.worker?worker";
import { emitDevLog, emitPerformanceLog } from "@/lib/dev-logger";
import { metricsCollector } from "@/lib/performance-metrics";

interface WorkerRequest {
  id: number;
  resolve: (data: any) => void;
  reject: (error: any) => void;
  onProgress?: (percent: number, message: string) => void;
}

export function useCsvWorker() {
  const workerRef = useRef<Worker | null>(null);
  const requestMapRef = useRef<Map<number, WorkerRequest>>(new Map());
  const requestIdCounterRef = useRef(1);
  const warmPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const worker = new CsvWorker();
    workerRef.current = worker;

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
              duration: data?.duration ?? 0,
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
              duration: data?.duration ?? 0,
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
      // Clear all pending requests
      requestMapRef.current.forEach((request) => {
        request.reject(new Error("Worker terminated"));
      });
      requestMapRef.current.clear();

      // Terminate worker
      worker.terminate();
      workerRef.current = null;
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
        });

        workerRef.current?.postMessage({
          requestId: id,
          type: "parse",
          data: { csvText, name, hasHeaders, headersOnly, withProgress },
        });
      });
    },
    [],
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
      });

      workerRef.current?.postMessage({
        requestId: id,
        type: "warm-wasm",
        data: {},
      });
    });

    return warmPromiseRef.current;
  }, []);
  const compare = useCallback(
    (
      source: any,
      target: any,
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
        });

        workerRef.current?.postMessage({
          requestId: id,
          type: "compare",
          data: {
            source,
            target,
            ...options,
          },
        });
      });
    },
    [],
  );

  return { parse, compare, warmWasm };
}
