import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ValidationRunner } from "../src/services/validation-runner.js";

describe("ValidationRunner", () => {
  it("reports a successful command", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      const result = await new ValidationRunner().run(
        {
          id: "echo",
          label: "echo",
          command: ["node", "-e", "console.log('ok')"],
          timeoutSec: 10,
        },
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

  it("skips npm scripts that are not defined in package.json", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "demo", scripts: { typecheck: "tsc --noEmit" } }),
      );
      const result = await new ValidationRunner().run(
        {
          id: "test",
          label: "test",
          command: ["npm", "test"],
          timeoutSec: 10,
        },
        cwd,
      );
      expect(result.status).toBe("skipped");
      expect(result.skipReason).toContain("test");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("runs npm --version through Windows cmd shims when needed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      const result = await new ValidationRunner().run(
        {
          id: "npm-version",
          label: "npm-version",
          command: ["npm", "--version"],
          timeoutSec: 20,
        },
        cwd,
      );
      expect(result.status).toBe("passed");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+/);
      expect(result.stderr).not.toContain("ENOENT");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("truncates oversized output while streaming", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-"));
    try {
      const result = await new ValidationRunner().run(
        {
          id: "big",
          label: "big",
          command: [
            "node",
            "-e",
            "process.stdout.write('x'.repeat(2_000_000));",
          ],
          timeoutSec: 10,
        },
        cwd,
      );
      expect(result.status).toBe("passed");
      expect(result.stdout).toContain("...[output truncated]");
      expect(result.stdout.length).toBeLessThanOrEqual(1_000_000 + 30);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
