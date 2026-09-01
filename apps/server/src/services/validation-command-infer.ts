import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidationCommand } from "@bugfix-harness/shared";

interface PackageJson {
  scripts?: Record<string, string>;
  packageManager?: string;
}

export function readPackageJson(repoPath: string): PackageJson | null {
  const path = join(repoPath, "package.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

export function detectPackageManager(repoPath: string): "npm" | "pnpm" | "yarn" {
  if (existsSync(join(repoPath, "pnpm-lock.yaml")) || existsSync(join(repoPath, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(repoPath, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

export function packageScriptName(command: string[]): string | null {
  const tokens = command.map((item) => item.replace(/\.cmd$/i, "").toLowerCase());
  const bin = tokens[0] ?? "";
  if (bin !== "npm" && bin !== "pnpm" && bin !== "yarn") {
    return null;
  }
  if (tokens[1] === "test") {
    return "test";
  }
  if (tokens[1] === "run" && tokens[2]) {
    return command[2] ?? tokens[2];
  }
  return null;
}

function hasUsableScript(scripts: Record<string, string> | undefined, name: string): boolean {
  const script = scripts?.[name];
  if (!script?.trim()) {
    return false;
  }
  return !/no test specified/i.test(script);
}

export function missingPackageScriptReason(
  command: string[],
  repoPath: string,
): string | null {
  const script = packageScriptName(command);
  if (!script) {
    return null;
  }
  const pkg = readPackageJson(repoPath);
  if (!pkg) {
    return null;
  }
  if (hasUsableScript(pkg.scripts, script)) {
    return null;
  }
  return `package.json 没有 "${script}" 脚本，已跳过`;
}

export function inferValidationCommands(repoPath: string): ValidationCommand[] {
  const pkg = readPackageJson(repoPath);
  if (!pkg?.scripts) {
    return [];
  }
  const pm = detectPackageManager(repoPath);
  const commands: ValidationCommand[] = [];
  if (hasUsableScript(pkg.scripts, "test")) {
    commands.push({
      id: "test",
      label: "运行测试",
      command: [pm, "test"],
      timeoutSec: 300,
    });
  }
  if (hasUsableScript(pkg.scripts, "typecheck")) {
    commands.push({
      id: "typecheck",
      label: "类型检查",
      command: pm === "yarn" ? [pm, "typecheck"] : [pm, "run", "typecheck"],
      timeoutSec: 300,
    });
  }
  if (hasUsableScript(pkg.scripts, "lint")) {
    commands.push({
      id: "lint",
      label: "Lint",
      command: pm === "yarn" ? [pm, "lint"] : [pm, "run", "lint"],
      timeoutSec: 300,
    });
  }
  return commands;
}

export function reconcileValidationCommands(
  repoPath: string,
  commands: ValidationCommand[],
): ValidationCommand[] {
  const usable = commands.filter(
    (command) => !missingPackageScriptReason(command.command, repoPath),
  );
  if (usable.length > 0) {
    return usable;
  }
  return inferValidationCommands(repoPath);
}
