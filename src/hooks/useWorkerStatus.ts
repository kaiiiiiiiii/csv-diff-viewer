import { useCallback, useEffect, useState } from "react";

export interface ThreadStatus {
  id: number;
  status: "idle" | "running" | "completed" | "error";
  currentTask?: string;
  progress?: number;
  itemsProcessed?: number;
  totalItems?: number;
}

export interface WorkerStatus {
  isActive: boolean;
  currentOperation?: string;
  queueLength: number;
  threads: Array<ThreadStatus>;
  memoryUsage?: {
    wasm: number;
    js: number;
  };
}

function hasChanges<T extends object>(prev: T, updates: Partial<T>): boolean {
  return (Object.keys(updates) as Array<keyof T>).some(
    (k) => prev[k] !== updates[k],
  );
}

export function useWorkerStatus() {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({
    isActive: false,
    queueLength: 0,
    threads: [],
  });

  const updateWorkerStatus = useCallback((updates: Partial<WorkerStatus>) => {
    setWorkerStatus((prev) =>
      hasChanges(prev, updates) ? { ...prev, ...updates } : prev,
    );
  }, []);

  const updateThreadStatus = useCallback(
    (threadId: number, updates: Partial<ThreadStatus>) => {
      setWorkerStatus((prev) => {
        const idx = prev.threads.findIndex((t) => t.id === threadId);
        if (idx === -1 || !hasChanges(prev.threads[idx], updates)) return prev;
        const threads = prev.threads.slice();
        threads[idx] = { ...threads[idx], ...updates };
        return { ...prev, threads };
      });
    },
    [],
  );

  useEffect(() => {
    // Listen for dev-log events from worker
    const handleDevLog = (event: CustomEvent) => {
      const { scope, message, details, status } = event.detail;

      if (
        scope === "Worker Threads" &&
        details &&
        typeof details === "object" &&
        "threadId" in details
      ) {
        const {
          threadId,
          status: threadStatus,
          currentTask,
          progress,
          itemsProcessed,
          totalItems,
        } = details;
        updateThreadStatus(threadId, {
          status: threadStatus as ThreadStatus["status"],
          currentTask,
          progress,
          itemsProcessed,
          totalItems,
        });
      } else if (scope === "Worker Pool") {
        const queueLength =
          details && typeof details === "object" && "queueLength" in details
            ? details.queueLength
            : 0;

        setWorkerStatus((prev: WorkerStatus) => {
          const next = {
            isActive: status === "running",
            queueLength,
            currentOperation: message.includes("Processing")
              ? message.split(" ")[1]
              : prev.currentOperation,
          };
          return hasChanges(prev, next) ? { ...prev, ...next } : prev;
        });
      }
    };

    window.addEventListener("dev-log", handleDevLog as EventListener);

    return () => {
      window.removeEventListener("dev-log", handleDevLog as EventListener);
    };
  }, [updateWorkerStatus, updateThreadStatus]);

  // Initialize thread pool based on hardware concurrency
  useEffect(() => {
    const numThreads = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    const threads: Array<ThreadStatus> = Array.from(
      { length: numThreads },
      (_, i) => ({
        id: i,
        status: "idle",
      }),
    );
    updateWorkerStatus({ threads });

    // Cleanup function to reset state on unmount
    return () => {
      setWorkerStatus({
        isActive: false,
        queueLength: 0,
        threads: [],
        memoryUsage: undefined,
        currentOperation: undefined,
      });
    };
  }, [updateWorkerStatus]);

  return { workerStatus, updateWorkerStatus, updateThreadStatus };
}
