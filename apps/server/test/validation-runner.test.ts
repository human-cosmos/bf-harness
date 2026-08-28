import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ValidationRunner } from "../src/services/validation-runner.js";

describe("ValidationRunner", () => {
  it("reports a successful command", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      const result = await new ValidationRunner().run(
        { id: "echo", label: "echo", command: ["echo", "ok"], timeoutSec: 10 },
        cwd,
      );
      expect(result.status).toBe("passed");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ok");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports a failed command", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      const result = await new ValidationRunner().run(
        { id: "bad", label: "bad", command: ["node", "-e", "process.exit(2)"], timeoutSec: 10 },
        cwd,
      );
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("times out a long-running command", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      const result = await new ValidationRunner().run(
        {
          id: "slow",
          label: "slow",
          command: ["node", "-e", "setTimeout(()=>{}, 5000)"],
          timeoutSec: 1,
        },
        cwd,
      );
      expect(result.status).toBe("timeout");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
