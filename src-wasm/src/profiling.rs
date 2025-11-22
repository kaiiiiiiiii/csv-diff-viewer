/// Performance profiling utilities for WASM operations.
/// 
/// This module provides lightweight profiling hooks to track
/// performance bottlenecks in CSV parsing and diffing operations.

use std::time::Instant;

/// Performance profiler for tracking operation times
pub struct Profiler {
    start: Instant,
    checkpoints: Vec<(String, Instant)>,
}

impl Profiler {
    /// Create a new profiler
    pub fn new() -> Self {
        Self {
            start: Instant::now(),
            checkpoints: Vec::with_capacity(10),
        }
    }

    /// Record a checkpoint with a label
    pub fn checkpoint(&mut self, label: impl Into<String>) {
        self.checkpoints.push((label.into(), Instant::now()));
    }

    /// Get elapsed time since start in milliseconds
    pub fn elapsed_ms(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }

    /// Get time between checkpoints in milliseconds
    pub fn checkpoint_times(&self) -> Vec<(String, f64)> {
        let mut times = Vec::with_capacity(self.checkpoints.len());
        let mut prev = self.start;
        
        for (label, instant) in &self.checkpoints {
            let duration = instant.duration_since(prev).as_secs_f64() * 1000.0;
            times.push((label.clone(), duration));
            prev = *instant;
        }
        
        times
    }

    /// Log profiling results (for debugging)
    #[cfg(debug_assertions)]
    pub fn log(&self) {
        web_sys::console::log_1(&format!("Total time: {:.2}ms", self.elapsed_ms()).into());
        for (label, duration) in self.checkpoint_times() {
            web_sys::console::log_1(&format!("  {}: {:.2}ms", label, duration).into());
        }
    }

    #[cfg(not(debug_assertions))]
    pub fn log(&self) {
        // No-op in release builds
    }
}

impl Default for Profiler {
    fn default() -> Self {
        Self::new()
    }
}

/// Memory usage tracker
pub struct MemoryTracker {
    initial: usize,
}

impl MemoryTracker {
    /// Create a new memory tracker
    pub fn new() -> Self {
        Self {
            initial: Self::current_usage(),
        }
    }

    /// Get current memory usage in bytes (approximate)
    fn current_usage() -> usize {
        // Note: In WASM, we can't get precise memory usage
        // This is a placeholder for future WASM memory API
        0
    }

    /// Get memory delta in MB
    pub fn delta_mb(&self) -> f64 {
        let current = Self::current_usage();
        ((current as i64 - self.initial as i64) as f64) / 1024.0 / 1024.0
    }
}

impl Default for MemoryTracker {
    fn default() -> Self {
        Self::new()
    }
}
