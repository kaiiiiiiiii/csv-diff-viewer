import { createScopedLogger } from "@/lib/dev-logger";

const perfLogger = createScopedLogger("Performance Config");

/**
 * Performance configuration for CSV diff operations.
 *
 * This module provides runtime configuration for various performance
 * optimizations, allowing users to tune behavior for their specific use case.
 */

export interface PerformanceConfig {
  /** Enable binary encoding for WASM-JS communication (default: true) */
  useBinaryEncoding: boolean;

  /** Chunk size for incremental diff processing (default: 10000 rows) */
  chunkSize: number;

  /** Similarity threshold for fuzzy matching (0.0-1.0, default: 0.5) */
  similarityThreshold: number;

  /** Enable performance metrics collection (default: true) */
  collectMetrics: boolean;

  /** Buffer pool max size for WASM allocations (default: 10) */
  bufferPoolSize: number;

  /** Enable console logging of performance metrics (default: false) */
  logMetrics: boolean;

  /** Maximum memory usage before triggering GC hint in MB (default: 500) */
  maxMemoryMB: number;
}

/**
 * Default performance configuration optimized for most use cases.
 */
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  useBinaryEncoding: true,
  chunkSize: 10000,
  similarityThreshold: 0.5,
  collectMetrics: true,
  bufferPoolSize: 10,
  logMetrics: false,
  maxMemoryMB: 500,
};

/**
 * Performance profiles for different scenarios.
 */
export const PERFORMANCE_PROFILES = {
  /** Optimized for speed, may use more memory */
  SPEED: {
    ...DEFAULT_PERFORMANCE_CONFIG,
    useBinaryEncoding: true,
    chunkSize: 50000,
    bufferPoolSize: 20,
  } as PerformanceConfig,

  /** Balanced speed and memory usage */
  BALANCED: DEFAULT_PERFORMANCE_CONFIG,

  /** Optimized for memory efficiency, may be slower */
  MEMORY: {
    ...DEFAULT_PERFORMANCE_CONFIG,
    chunkSize: 5000,
    bufferPoolSize: 5,
    maxMemoryMB: 250,
  } as PerformanceConfig,

  /** Debug mode with detailed logging */
  DEBUG: {
    ...DEFAULT_PERFORMANCE_CONFIG,
    useBinaryEncoding: false, // Easier to debug JSON
    collectMetrics: true,
    logMetrics: true,
  } as PerformanceConfig,
};

/**
 * Get the current performance configuration.
 * This can be extended to load from localStorage or user preferences.
 */
export function getPerformanceConfig(): PerformanceConfig {
  // Check for stored config
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("csv-diff-performance-config");
    if (stored) {
      try {
        return { ...DEFAULT_PERFORMANCE_CONFIG, ...JSON.parse(stored) };
      } catch (e) {
        perfLogger.warn("Failed to parse stored performance config", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return DEFAULT_PERFORMANCE_CONFIG;
}

/**
 * Save performance configuration to localStorage.
 */
export function savePerformanceConfig(
  config: Partial<PerformanceConfig>,
): void {
  if (typeof localStorage !== "undefined") {
    const fullConfig = { ...getPerformanceConfig(), ...config };
    localStorage.setItem(
      "csv-diff-performance-config",
      JSON.stringify(fullConfig),
    );
  }
}

/**
 * Reset performance configuration to defaults.
 */
export function resetPerformanceConfig(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("csv-diff-performance-config");
  }
}

/**
 * Apply a performance profile.
 */
export function applyPerformanceProfile(
  profile: keyof typeof PERFORMANCE_PROFILES,
): void {
  savePerformanceConfig(PERFORMANCE_PROFILES[profile]);
}
