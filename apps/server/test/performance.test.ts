import { describe, expect, it } from "vitest";
import { performanceReport } from "../src/services/performance.js";

describe("performance targets", () => {
  it("passes within V1 thresholds", () => {
    const report = performanceReport({
      coldStartMs: 2_000,
      pageResponseMs: 150,
      eventDeliveryMs: 400,
      retainedEvents: 10_000,
    });
    expect(report.coldStartOk).toBe(true);
    expect(report.pageResponseOk).toBe(true);
    expect(report.eventDeliveryOk).toBe(true);
    expect(report.retainedEventsOk).toBe(true);
  });

  it("fails when a threshold is exceeded", () => {
    const report = performanceReport({
      coldStartMs: 6_000,
      pageResponseMs: 150,
      eventDeliveryMs: 400,
      retainedEvents: 10_000,
    });
    expect(report.coldStartOk).toBe(false);
  });
});
