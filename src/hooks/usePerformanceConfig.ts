import { useEffect, useRef, useState } from "react";
import type { PerformanceConfig } from "@/lib/performance-config";
import {
  PERFORMANCE_PROFILES,
  getPerformanceConfig,
  savePerformanceConfig,
} from "@/lib/performance-config";
import { createScopedLogger } from "@/lib/dev-logger";

const perfLogger = createScopedLogger("Performance Config");

/**
 * React hook for managing performance configuration.
 *
 * Provides access to current performance settings and methods to update them.
 * Changes are persisted to localStorage automatically.
 */
export function usePerformanceConfig() {
  const [config, setConfig] = useState<PerformanceConfig>(getPerformanceConfig);

  // Latest config, so updates compose without persisting inside a state updater
  const configRef = useRef(config);

  // Update config and persist to localStorage
  const updateConfig = (updates: Partial<PerformanceConfig>) => {
    const newConfig = { ...configRef.current, ...updates };
    configRef.current = newConfig;
    setConfig(newConfig);
    savePerformanceConfig(newConfig);
  };

  // Apply a performance profile
  const applyProfile = (profile: keyof typeof PERFORMANCE_PROFILES) => {
    const profileConfig = PERFORMANCE_PROFILES[profile];
    configRef.current = profileConfig;
    setConfig(profileConfig);
    savePerformanceConfig(profileConfig);
  };

  // Listen for storage changes (for multi-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "csv-diff-performance-config" && e.newValue) {
        try {
          const newConfig = JSON.parse(e.newValue);
          configRef.current = newConfig;
          setConfig(newConfig);
        } catch (err) {
          perfLogger.warn("Failed to parse performance config from storage", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return {
    config,
    updateConfig,
    applyProfile,
    profiles: PERFORMANCE_PROFILES,
  };
}
