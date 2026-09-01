import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ValidationCommand } from "@bugfix-harness/shared";

interface PackageJson {
  scripts?: Record<string, string>;
  packageManager?: string;
}

export interface ResolvedValidationCommand {
  command: ValidationCommand;
  cwd: string;
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
  if (bin === "yarn" && tokens[1] && tokens[1] !== "run") {
    return command[1] ?? tokens[1];
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

function packageDirs(repoPath: string, maxDepth = 4): string[] {
  const dirs = [repoPath];
  const ignored = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    ".turbo",
    "out",
    "vendor",
    ".output",
    "tmp",
    "temp",
    ".cache",
  ]);

  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignored.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (!existsSync(join(path, "package.json"))) {
        walk(path, depth + 1);
        continue;
      }
      dirs.push(path);
      walk(path, depth + 1);
    }
  };

  walk(repoPath, 0);
  return dirs;
}

function commandLabelFor(script: string): string {
  if (script === "test") return "运行测试";
  if (script === "typecheck") return "类型检查";
  if (script === "lint") return "Lint";
  return `运行 ${script}`;
}

function relativePackageDir(repoPath: string, dir: string): string {
  if (dir === repoPath) {
    return "";
  }
  return relative(repoPath, dir).replace(/\\/g, "/");
}

function withPackageScope(
  command: ValidationCommand,
  repoPath: string,
  dir: string,
): ValidationCommand {
  const rel = relativePackageDir(repoPath, dir);
  if (!rel) {
    return command;
  }
  return {
    ...command,
    id: `${command.id}:${rel}`,
    label: `${command.label} (${rel})`,
  };
}

function inferResolvedValidationCommands(
  repoPath: string,
): ResolvedValidationCommand[] {
  const rootPkg = readPackageJson(repoPath);
  const pm = detectPackageManager(repoPath);
  const dirs = packageDirs(repoPath);
  const commands: ResolvedValidationCommand[] = [];

  for (const script of ["test", "typecheck", "lint"]) {
    const rootHas = hasUsableScript(rootPkg?.scripts, script);
    if (rootHas) {
      commands.push({
        command: {
          id: script,
          label: commandLabelFor(script),
          command:
            script === "test"
              ? [pm, "test"]
              : pm === "yarn"
                ? [pm, script]
                : [pm, "run", script],
          timeoutSec: 300,
        },
        cwd: repoPath,
      });
      continue;
    }

    for (const dir of dirs.slice(1)) {
      const pkg = readPackageJson(dir);
      if (!pkg || !hasUsableScript(pkg.scripts, script)) continue;
      commands.push({
        command: {
          id: `${script}:${relativePackageDir(repoPath, dir)}`,
          label: `${commandLabelFor(script)} (${relativePackageDir(repoPath, dir)})`,
          command:
            script === "test"
              ? [pm, "test"]
              : pm === "yarn"
                ? [pm, script]
                : [pm, "run", script],
          timeoutSec: 300,
        },
        cwd: dir,
      });
    }
  }

  return commands;
}

export function resolveValidationCommands(
  repoPath: string,
  configured: ValidationCommand[],
): ResolvedValidationCommand[] {
  const dirs = packageDirs(repoPath);
  const resolved: ResolvedValidationCommand[] = [];

  for (const command of configured) {
    const script = packageScriptName(command.command);
    if (!script) {
      resolved.push({ command, cwd: repoPath });
      continue;
    }

    const matching = dirs.filter((dir) => {
      const pkg = readPackageJson(dir);
      return Boolean(pkg && hasUsableScript(pkg.scripts, script));
    });
    if (matching.length === 0) {
      continue;
    }
    if (matching.includes(repoPath)) {
      resolved.push({ command, cwd: repoPath });
      continue;
    }
    for (const dir of matching) {
      resolved.push({
        command: withPackageScope(command, repoPath, dir),
        cwd: dir,
      });
    }
  }

  if (resolved.length > 0) {
    return resolved;
  }
  return inferResolvedValidationCommands(repoPath);
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
