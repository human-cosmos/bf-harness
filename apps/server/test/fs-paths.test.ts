import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractJsonText } from "../src/services/agent-orchestrator.js";
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
