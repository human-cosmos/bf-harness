import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inferValidationCommands,
  missingPackageScriptReason,
  reconcileValidationCommands,
} from "../src/services/validation-command-infer.js";

function writePkg(dir: string, pkg: unknown) {
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

describe("validation command infer", () => {
  it("infers typecheck and skips placeholder test scripts", () => {
    const dir = mkdtempSync(join(tmpdir(), "bfh-infer-"));
    try {
      writePkg(dir, {
        scripts: {
          test: "echo \"Error: no test specified\" && exit 1",
          typecheck: "tsc --noEmit",
        },
      });
      expect(inferValidationCommands(dir)).toEqual([
        {
          id: "typecheck",
          label: "类型检查",
          command: ["npm", "run", "typecheck"],
          timeoutSec: 300,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers pnpm when a lockfile exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "bfh-infer-"));
    try {
      writePkg(dir, { scripts: { test: "vitest run" } });
      writeFileSync(join(dir, "pnpm-lock.yaml"), "");
      expect(inferValidationCommands(dir)[0]?.command).toEqual(["pnpm", "test"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops missing npm scripts when reconciling", () => {
    const dir = mkdtempSync(join(tmpdir(), "bfh-infer-"));
    try {
      writePkg(dir, { scripts: { typecheck: "tsc --noEmit" } });
      const reconciled = reconcileValidationCommands(dir, [
        {
          id: "test",
          label: "运行测试",
          command: ["npm", "test"],
          timeoutSec: 300,
        },
        {
          id: "typecheck",
          label: "类型检查",
          command: ["npm", "run", "typecheck"],
          timeoutSec: 300,
        },
      ]);
      expect(reconciled.map((item) => item.id)).toEqual(["typecheck"]);
      expect(missingPackageScriptReason(["npm", "test"], dir)).toContain("test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
