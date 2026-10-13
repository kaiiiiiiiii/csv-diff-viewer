/**
 * Memory leak prevention utilities
 * These functions help prevent memory leaks when the page is refreshed or navigated away from
 */

/** Keys that must survive cleanup (user preferences). */
export const PROTECTED_STORAGE_KEYS = ["theme", "csv-diff-performance-config"];

/** Prefixes of app-owned, ephemeral localStorage entries safe to drop on unload. */
export const EPHEMERAL_STORAGE_PREFIXES = ["csv-diff-tmp:", "csv-diff-cache:"];

function isEphemeralKey(key: string): boolean {
  if (PROTECTED_STORAGE_KEYS.includes(key)) return false;
  return EPHEMERAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Setup global cleanup handlers to prevent memory leaks on page unload
 */
export function setupGlobalCleanup(): () => void {
  // Clear all data on page unload to prevent accumulation
  const handleBeforeUnload = () => {
    // Clear any large data structures that might be held in memory
    if ("gc" in window && typeof window.gc === "function") {
      // Force garbage collection if available (Chrome dev tools)
      try {
        (window as any).gc();
      } catch {
        // Ignore if gc is not available
      }
    }

    // Remove only ephemeral keys this app owns; user preferences persist
    try {
      const keysToRemove: Array<string> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && isEphemeralKey(key)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore localStorage errors
    }

    // Clear sessionStorage which might contain temporary data
    try {
      sessionStorage.clear();
    } catch {
      // Ignore sessionStorage errors
    }
  };

  // Listen for page unload events
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("pagehide", handleBeforeUnload);

  // Return cleanup function
  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    window.removeEventListener("pagehide", handleBeforeUnload);
  };
}

/**
 * Monitor memory usage and log warnings if it gets too high
 */
export function setupMemoryMonitoring(): void {
  if (typeof window === "undefined") return;

  // Check memory every 30 seconds
  const interval = setInterval(() => {
    const perf = performance as any;
    if (perf.memory) {
      const usedMB = perf.memory.usedJSHeapSize / 1024 / 1024;
      const totalMB = perf.memory.totalJSHeapSize / 1024 / 1024;
      const limitMB = perf.memory.jsHeapSizeLimit / 1024 / 1024;

      // Warn if memory usage is high
      if (usedMB > totalMB * 0.9) {
        console.warn(
          `High memory usage detected: ${usedMB.toFixed(2)}MB / ${totalMB.toFixed(2)}MB (${limitMB.toFixed(2)}MB limit)`,
        );

        // Trigger garbage collection if available
        if ("gc" in window && typeof window.gc === "function") {
          try {
            (window as any).gc();
          } catch {
            // Ignore if gc is not available
          }
        }
      }
    }
  }, 30000);

  // Clear interval on page unload
  window.addEventListener("beforeunload", () => {
    clearInterval(interval);
  });
}
