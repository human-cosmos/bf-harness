import { describe, expect, it } from "vitest";
import { DiskMonitor } from "../src/services/disk-monitor.js";

describe("DiskMonitor", () => {
  it("reports usage for the current directory", () => {
    const result = new DiskMonitor().check(process.cwd());
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.usedRatio).toBeGreaterThanOrEqual(0);
    expect(result.usedRatio).toBeLessThanOrEqual(1);
  });
});
