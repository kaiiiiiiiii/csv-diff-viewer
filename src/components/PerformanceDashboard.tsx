import React, { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, Zap } from "lucide-react";
import type { DevLogEvent, PerformanceLogEvent } from "@/lib/dev-logger";
import type { ThreadStatus } from "@/hooks/useWorkerStatus";
import {
  DEV_LOG_EVENT,
  PERFORMANCE_LOG_EVENT,
  emitPerformanceLog,
} from "@/lib/dev-logger";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useWorkerStatus } from "@/hooks/useWorkerStatus";

// Type guard for performance.memory API (Chrome-specific)
interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

interface OperationLog extends PerformanceLogEvent {
  id: string;
}

interface DevLogEntry extends DevLogEvent {
  id: string;
}

export const PerformanceDashboard: React.FC = () => {
  const [operations, setOperations] = useState<Array<OperationLog>>([]);
  const [devLogs, setDevLogs] = useState<Array<DevLogEntry>>([]);
  const [memoryInfo, setMemoryInfo] = useState<{
    used: number;
    total: number;
    limit: number;
  } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const { workerStatus } = useWorkerStatus();

  // Keyboard shortcut activation (Ctrl+Shift+P or Cmd+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
        e.preventDefault();
        setIsVisible((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Check activation state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("perfDashboardActive");
    if (stored !== null) {
      setIsVisible(stored === "true");
    }
  }, []);

  // Persist activation state
  useEffect(() => {
    localStorage.setItem("perfDashboardActive", String(isVisible));
  }, [isVisible]);

  // Monitor memory usage
  useEffect(() => {
    if (!isVisible) return;

    const updateMemory = () => {
      const perfWithMemory = performance as PerformanceWithMemory;
      if (perfWithMemory.memory) {
        const mem = perfWithMemory.memory;
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
      const detail = event.detail as PerformanceLogEvent;
      const newLog: OperationLog = {
        ...detail,
        id: `${detail.timestamp ?? Date.now()}-${Math.random()}`,
        timestamp: detail.timestamp ?? Date.now(),
      };

      setOperations((prev) => [newLog, ...prev].slice(0, 50));
    };

    window.addEventListener(
      PERFORMANCE_LOG_EVENT,
      handlePerformanceEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        PERFORMANCE_LOG_EVENT,
        handlePerformanceEvent as EventListener,
      );
    };
  }, [isVisible]);

  // Listen for general dev log events
  useEffect(() => {
    if (!isVisible) return;

    const handleDevLog = (event: CustomEvent) => {
      const detail = event.detail as DevLogEvent;
      const newLog: DevLogEntry = {
        ...detail,
        id: `${detail.timestamp ?? Date.now()}-${Math.random()}`,
        timestamp: detail.timestamp ?? Date.now(),
      };

      setDevLogs((prev) => [newLog, ...prev].slice(0, 100));
    };

    window.addEventListener(DEV_LOG_EVENT, handleDevLog as EventListener);
    return () => {
      window.removeEventListener(DEV_LOG_EVENT, handleDevLog as EventListener);
    };
  }, [isVisible]);

  // Cleanup logs when component unmounts or becomes invisible
  useEffect(() => {
    if (!isVisible) {
      // Clear logs when hidden to free memory
      setOperations([]);
      setDevLogs([]);
      setMemoryInfo(null);
    }
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

  const levelStyles = useMemo(() => {
    return {
      info: "text-blue-600",
      success: "text-green-600",
      warn: "text-yellow-600",
      error: "text-red-600",
      debug: "text-gray-500",
    } satisfies Record<string, string>;
  }, []);

  const levelIcons = useMemo(() => {
    return {
      info: "ℹ️",
      success: "✅",
      warn: "⚠️",
      error: "⛔",
      debug: "🐞",
    } satisfies Record<string, string>;
  }, []);

  const getThreadStatusIcon = (status: ThreadStatus["status"]) => {
    switch (status) {
      case "running":
        return <Activity className="h-3 w-3 animate-pulse text-blue-500" />;
      case "completed":
        return <Zap className="h-3 w-3 text-green-500" />;
      case "error":
        return <span className="h-3 w-3 text-red-500">⚠️</span>;
      default:
        return <span className="h-3 w-3 text-gray-400">○</span>;
    }
  };

  const formatProgress = (thread: ThreadStatus) => {
    if (
      thread.itemsProcessed !== undefined &&
      thread.totalItems !== undefined
    ) {
      return `${thread.itemsProcessed} / ${thread.totalItems}`;
    }
    if (thread.progress !== undefined) {
      return `${thread.progress.toFixed(1)}%`;
    }
    return "";
  };

  return (
    <div className="fixed bottom-4 right-4 w-[600px] max-h-[80vh] overflow-hidden bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <span>Performance Dashboard</span>
            <Badge variant="outline" className="text-xs">
              Active
            </Badge>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Ctrl+Shift+P to toggle
            </span>
          </div>
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

      <div className="overflow-y-auto max-h-[60vh] p-2 space-y-4">
        <Accordion
          type="multiple"
          defaultValue={["workers", "threads"]}
          className="space-y-4"
        >
          <AccordionItem value="workers">
            <AccordionTrigger className="py-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                <span className="text-sm font-medium">Worker Pool Status</span>
                <Badge
                  variant={workerStatus.isActive ? "default" : "secondary"}
                  className="ml-auto"
                >
                  {workerStatus.isActive ? "Active" : "Idle"}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">
                    Current Operation:
                  </span>
                  <div className="font-medium">
                    {workerStatus.currentOperation || "None"}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">
                    Queue Length:
                  </span>
                  <div className="font-medium">{workerStatus.queueLength}</div>
                </div>
                {workerStatus.memoryUsage && (
                  <>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">
                        WASM Memory:
                      </span>
                      <div className="font-medium">
                        {formatMemory(workerStatus.memoryUsage.wasm)}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">
                        JS Heap:
                      </span>
                      <div className="font-medium">
                        {formatMemory(workerStatus.memoryUsage.js)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="threads">
            <AccordionTrigger className="py-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                <span className="text-sm font-medium">Thread Pool</span>
                <Badge variant="outline" className="ml-auto">
                  {workerStatus.threads.length} threads
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-4">
              {workerStatus.threads.map((thread) => (
                <div
                  key={thread.id}
                  className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40"
                >
                  <div className="flex items-center gap-2">
                    {getThreadStatusIcon(thread.status)}
                    <span className="text-xs font-medium">
                      Thread {thread.id}
                    </span>
                  </div>
                  <div className="flex-1 mx-3">
                    {thread.currentTask && (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {thread.currentTask}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatProgress(thread)}
                    </div>
                    <Badge
                      variant={
                        thread.status === "running"
                          ? "default"
                          : thread.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {thread.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <section>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300 uppercase">
              Recent Operations
            </h4>
            <span className="text-[10px] text-gray-400">
              {operations.length} entries
            </span>
          </div>
          {operations.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 text-xs py-4">
              No operations logged yet
            </div>
          ) : (
            <div className="space-y-2">
              {operations.map((op) => (
                <Card key={op.id} className="p-2 text-xs">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-semibold">{op.operation}</div>
                      <div className="text-gray-500 dark:text-gray-400">
                        {new Date(
                          op.timestamp ?? Date.now(),
                        ).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-semibold ${getStatusColor(op.status)}`}
                      >
                        {op.status.toUpperCase()}
                      </div>
                      <div className="font-mono">
                        {formatDuration(op.duration)}
                      </div>
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
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300 uppercase">
              Debug Console
            </h4>
            <span className="text-[10px] text-gray-400">
              {devLogs.length} entries
            </span>
          </div>
          {devLogs.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 text-xs py-4">
              No debug messages yet
            </div>
          ) : (
            <div className="space-y-1">
              {devLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-2 py-1.5 text-[11px]"
                >
                  <div className="flex-1 pr-2">
                    <div className="flex items-center gap-1">
                      <span
                        className={`${levelStyles[log.level ?? "info"]} text-sm`}
                      >
                        {levelIcons[log.level ?? "info"]}
                      </span>
                      <span className="font-semibold text-gray-800 dark:text-gray-100">
                        {log.scope}
                      </span>
                      {log.status && (
                        <span className="rounded-full bg-gray-200 dark:bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-600 dark:text-gray-300">
                          {log.status}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-700 dark:text-gray-300">
                      {log.message}
                    </div>
                    {log.details && (
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-black/5 dark:bg-black/30 p-1 font-mono text-[10px] text-gray-600 dark:text-gray-300">
                        {typeof log.details === "string"
                          ? log.details
                          : JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {new Date(log.timestamp ?? Date.now()).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
export const logPerformance = emitPerformanceLog;
