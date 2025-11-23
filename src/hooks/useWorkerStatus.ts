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

export function useWorkerStatus() {
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({
    isActive: false,
    queueLength: 0,
    threads: [],
  });

  const updateWorkerStatus = useCallback((updates: Partial<WorkerStatus>) => {
    setWorkerStatus((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateThreadStatus = useCallback(
    (threadId: number, updates: Partial<ThreadStatus>) => {
      setWorkerStatus((prev) => ({
        ...prev,
        threads: prev.threads.map((thread) =>
          thread.id === threadId ? { ...thread, ...updates } : thread,
        ),
      }));
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

        setWorkerStatus((prev: WorkerStatus) => ({
          ...prev,
          isActive: status === "running",
          queueLength,
          currentOperation: message.includes("Processing")
            ? message.split(" ")[1]
            : prev.currentOperation,
        }));
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
