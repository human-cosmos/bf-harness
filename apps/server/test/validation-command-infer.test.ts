import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inferValidationCommands,
  missingPackageScriptReason,
  packageScriptName,
  reconcileValidationCommands,
  resolveValidationCommands,
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

  it("recognizes yarn scripts that omit run", () => {
    expect(packageScriptName(["yarn", "typecheck"])).toBe("typecheck");
    expect(packageScriptName(["yarn", "run", "lint"])).toBe("lint");
  });

  it("keeps a configured root script at the repo root", () => {
    const dir = mkdtempSync(join(tmpdir(), "bfh-resolve-root-"));
    try {
      writePkg(dir, { scripts: { test: "vitest run" } });
      mkdirSync(join(dir, "packages", "app"), { recursive: true });
      writePkg(join(dir, "packages", "app"), { scripts: { test: "vitest run" } });
      const resolved = resolveValidationCommands(dir, [
        {
          id: "test",
          label: "运行测试",
          command: ["npm", "test"],
          timeoutSec: 300,
        },
      ]);
      expect(resolved).toEqual([
        {
          command: {
            id: "test",
            label: "运行测试",
            command: ["npm", "test"],
            timeoutSec: 300,
          },
          cwd: dir,
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fans out to packages only when the root has no matching script", () => {
    const dir = mkdtempSync(join(tmpdir(), "bfh-resolve-fanout-"));
    try {
      writePkg(dir, { scripts: { lint: "eslint ." } });
      mkdirSync(join(dir, "packages", "web"), { recursive: true });
      mkdirSync(join(dir, "packages", "server"), { recursive: true });
      writePkg(join(dir, "packages", "web"), { scripts: { test: "vitest run" } });
      writePkg(join(dir, "packages", "server"), {
        scripts: { test: "vitest run" },
      });
      const resolved = resolveValidationCommands(dir, [
        {
          id: "test",
          label: "运行测试",
          command: ["npm", "test"],
          timeoutSec: 300,
        },
      ]);
      expect(
        resolved
          .map((item) => item.command.id)
          .sort(),
      ).toEqual(["test:packages/server", "test:packages/web"]);
      expect(resolved.map((item) => item.cwd).sort()).toEqual([
        join(dir, "packages", "server"),
        join(dir, "packages", "web"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("infers child package scripts when nothing is configured", () => {
    const dir = mkdtempSync(join(tmpdir(), "bfh-resolve-infer-"));
    try {
      writePkg(dir, { name: "root" });
      mkdirSync(join(dir, "apps", "web"), { recursive: true });
      writePkg(join(dir, "apps", "web"), {
        scripts: { typecheck: "tsc --noEmit" },
      });
      expect(resolveValidationCommands(dir, [])).toEqual([
        {
          command: {
            id: "typecheck:apps/web",
            label: "类型检查 (apps/web)",
            command: ["npm", "run", "typecheck"],
            timeoutSec: 300,
          },
          cwd: join(dir, "apps", "web"),
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
