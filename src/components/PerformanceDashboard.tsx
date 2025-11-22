import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";

interface PerformanceMetrics {
  startTime: number;
  parseTime?: number;
  diffTime?: number;
  serializeTime?: number;
  totalTime?: number;
  memoryUsed?: number;
}

interface OperationLog {
  id: string;
  timestamp: number;
  operation: string;
  duration: number;
  status: "success" | "error" | "running";
  metrics?: PerformanceMetrics;
  error?: string;
}

export const PerformanceDashboard: React.FC = () => {
  const [operations, setOperations] = useState<OperationLog[]>([]);
  const [memoryInfo, setMemoryInfo] = useState<{
    used: number;
    total: number;
    limit: number;
  } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Check if we're in development mode
  useEffect(() => {
    const isDev = import.meta.env.DEV;
    setIsVisible(isDev);
  }, []);

  // Monitor memory usage
  useEffect(() => {
    if (!isVisible) return;

    const updateMemory = () => {
      if ("memory" in performance) {
        const mem = (performance as any).memory;
        setMemoryInfo({
          used: mem.usedJSHeapSize / 1024 / 1024,
          total: mem.totalJSHeapSize / 1024 / 1024,
          limit: mem.jsHeapSizeLimit / 1024 / 1024,
        });
      }
    };

    updateMemory();
    const interval = setInterval(updateMemory, 1000);
    return () => clearInterval(interval);
  }, [isVisible]);

  // Listen for custom performance events
  useEffect(() => {
    if (!isVisible) return;

    const handlePerformanceEvent = (event: CustomEvent) => {
      const { operation, duration, metrics, status, error } = event.detail;
      const newLog: OperationLog = {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        operation,
        duration,
        status,
        metrics,
        error,
      };

      setOperations((prev) => [newLog, ...prev].slice(0, 50)); // Keep last 50 operations
    };

    window.addEventListener(
      "performance-log",
      handlePerformanceEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        "performance-log",
        handlePerformanceEvent as EventListener,
      );
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatMemory = (mb: number) => {
    return `${mb.toFixed(2)} MB`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "success":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "running":
        return "text-blue-600";
      default:
        return "text-gray-600";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 max-h-96 overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-sm">Performance Dashboard</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            DEV ONLY
          </span>
        </div>

        {memoryInfo && (
          <div className="mt-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">
                Memory Used:
              </span>
              <span className="font-mono">
                {formatMemory(memoryInfo.used)} /{" "}
                {formatMemory(memoryInfo.total)}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all"
                style={{
                  width: `${(memoryInfo.used / memoryInfo.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="overflow-y-auto max-h-80 p-2 space-y-2">
        {operations.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 text-xs py-4">
            No operations logged yet
          </div>
        ) : (
          operations.map((op) => (
            <Card key={op.id} className="p-2 text-xs">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="font-semibold">{op.operation}</div>
                  <div className="text-gray-500 dark:text-gray-400">
                    {new Date(op.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${getStatusColor(op.status)}`}>
                    {op.status.toUpperCase()}
                  </div>
                  <div className="font-mono">{formatDuration(op.duration)}</div>
                </div>
              </div>

              {op.metrics && (
                <div className="mt-2 text-xs space-y-1 border-t border-gray-200 dark:border-gray-700 pt-2">
                  {op.metrics.parseTime !== undefined && (
                    <div className="flex justify-between">
                      <span>Parse:</span>
                      <span className="font-mono">
                        {formatDuration(op.metrics.parseTime)}
                      </span>
                    </div>
                  )}
                  {op.metrics.diffTime !== undefined && (
                    <div className="flex justify-between">
                      <span>Diff:</span>
                      <span className="font-mono">
                        {formatDuration(op.metrics.diffTime)}
                      </span>
                    </div>
                  )}
                  {op.metrics.serializeTime !== undefined && (
                    <div className="flex justify-between">
                      <span>Serialize:</span>
                      <span className="font-mono">
                        {formatDuration(op.metrics.serializeTime)}
                      </span>
                    </div>
                  )}
                  {op.metrics.memoryUsed !== undefined && (
                    <div className="flex justify-between">
                      <span>WASM Memory:</span>
                      <span className="font-mono">
                        {formatMemory(op.metrics.memoryUsed)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {op.error && (
                <div className="mt-2 text-red-600 dark:text-red-400 text-xs p-1 bg-red-50 dark:bg-red-900/20 rounded">
                  {op.error}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

// Utility function to log performance events
export const logPerformance = (
  operation: string,
  duration: number,
  status: "success" | "error" | "running" = "success",
  metrics?: PerformanceMetrics,
  error?: string,
) => {
  const event = new CustomEvent("performance-log", {
    detail: {
      operation,
      duration,
      status,
      metrics,
      error,
    },
  });
  window.dispatchEvent(event);
};
