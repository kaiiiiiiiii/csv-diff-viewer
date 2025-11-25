export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface PerformanceMetrics {
  wasmInitTime?: PerformanceMetric;
  parseSourceTime?: PerformanceMetric;
  parseTargetTime?: PerformanceMetric;
  compareTime?: PerformanceMetric;
  totalTime?: PerformanceMetric;
}

class MetricsCollector {
  private metrics: PerformanceMetrics = {};

  startTimer(name: keyof PerformanceMetrics): void {
    this.metrics[name] = {
      name,
      startTime: performance.now(),
    };
  }

  endTimer(name: keyof PerformanceMetrics): void {
    const metric = this.metrics[name];
    if (metric && !metric.endTime) {
      metric.endTime = performance.now();
      metric.duration = metric.endTime - metric.startTime;
    }
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {};
  }

  // Convenience method to get a specific metric
  getMetric(name: keyof PerformanceMetrics): PerformanceMetric | undefined {
    return this.metrics[name];
  }

  // Log metrics to console (useful for debugging)
  logMetrics(): void {
    console.group("Performance Metrics");

    Object.entries(this.metrics).forEach(([key, metric]) => {
      if (metric && metric.duration) {
        console.log(`${key}: ${metric.duration.toFixed(2)}ms`);
      }
    });

    // Calculate derived metrics
    const parseTime =
      (this.metrics.parseSourceTime?.duration || 0) +
      (this.metrics.parseTargetTime?.duration || 0);
    const compareTime = this.metrics.compareTime?.duration || 0;
    const totalTime = this.metrics.totalTime?.duration || 0;

    if (parseTime > 0) {
      console.log(`Total Parse Time: ${parseTime.toFixed(2)}ms`);
    }

    if (compareTime > 0) {
      console.log(`Compare Time: ${compareTime.toFixed(2)}ms`);
    }

    if (totalTime > 0) {
      console.log(`Total Operation Time: ${totalTime.toFixed(2)}ms`);
      console.log(
        `Parse Percentage: ${((parseTime / totalTime) * 100).toFixed(1)}%`,
      );
      console.log(
        `Compare Percentage: ${((compareTime / totalTime) * 100).toFixed(1)}%`,
      );
    }

    console.groupEnd();
  }
}

// Export singleton instance
export const metricsCollector = new MetricsCollector();
