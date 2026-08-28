export interface PerformanceMetrics {
  coldStartMs: number;
  pageResponseMs: number;
  eventDeliveryMs: number;
  retainedEvents: number;
}

export const performanceTargets = {
  coldStartMs: 5_000,
  pageResponseMs: 300,
  eventDeliveryMs: 1_000,
  retainedEvents: 10_000,
};

export function performanceReport(metrics: PerformanceMetrics) {
  return {
    coldStartOk: metrics.coldStartMs <= performanceTargets.coldStartMs,
    pageResponseOk: metrics.pageResponseMs <= performanceTargets.pageResponseMs,
    eventDeliveryOk: metrics.eventDeliveryMs <= performanceTargets.eventDeliveryMs,
    retainedEventsOk: metrics.retainedEvents >= performanceTargets.retainedEvents,
    metrics,
  };
}
