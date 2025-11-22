import { useState, useEffect } from "react";
import {
  type PerformanceConfig,
  getPerformanceConfig,
  savePerformanceConfig,
  PERFORMANCE_PROFILES,
} from "@/lib/performance-config";

/**
 * React hook for managing performance configuration.
 *
 * Provides access to current performance settings and methods to update them.
 * Changes are persisted to localStorage automatically.
 */
export function usePerformanceConfig() {
  const [config, setConfig] = useState<PerformanceConfig>(getPerformanceConfig);

  // Update config and persist to localStorage
  const updateConfig = (updates: Partial<PerformanceConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    savePerformanceConfig(newConfig);
  };

  // Apply a performance profile
  const applyProfile = (profile: keyof typeof PERFORMANCE_PROFILES) => {
    const profileConfig = PERFORMANCE_PROFILES[profile];
    setConfig(profileConfig);
    savePerformanceConfig(profileConfig);
  };

  // Listen for storage changes (for multi-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "csv-diff-performance-config" && e.newValue) {
        try {
          const newConfig = JSON.parse(e.newValue);
          setConfig(newConfig);
        } catch (err) {
          console.warn("Failed to parse performance config from storage", err);
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
