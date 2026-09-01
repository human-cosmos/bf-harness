import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractJsonText,
  parseRepairPlanText,
} from "../src/services/agent-orchestrator.js";
import { resolveLongPath } from "../src/services/fs-paths.js";

describe("resolveLongPath", () => {
  it("expands an existing directory to a path without 8.3 segments", () => {
    const dir = mkdtempSync(join(tmpdir(), "bugfix-long-path-"));
    try {
      const resolved = resolveLongPath(dir);
      expect(resolved.toLowerCase()).not.toContain("admini~1");
      expect(resolved.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("extractJsonText", () => {
  it("returns a bare JSON object unchanged", () => {
    expect(extractJsonText('{"summary":"ok"}')).toBe('{"summary":"ok"}');
  });

  it("extracts a JSON object after leading prose", () => {
    expect(extractJsonText('The sandbox failed.{"summary":"ok","risks":[]}')).toBe(
      '{"summary":"ok","risks":[]}',
    );
  });
});

describe("parseRepairPlanText", () => {
  it("parses a complete repair plan after leading prose", () => {
    const plan = parseRepairPlanText(
      `Prose before the plan.{"problemSummary":"bug","rootCauseHypothesis":"cause","evidence":["log"],"proposedFiles":["src/app.ts"],"fixStrategy":"fix it","regressionTests":["npm test"],"validationCommands":["npm test"],"risks":[],"openQuestions":[]}`,
    );
    expect(plan.problemSummary).toBe("bug");
  });

  it("rejects truncated repair plan JSON with a clear message", () => {
    expect(() =>
      parseRepairPlanText(
        '{"problemSummary":"bug","rootCauseHypothesis":"unterminated',
      ),
    ).toThrow(/Failed to parse repair plan from agent output/);
  });
});
