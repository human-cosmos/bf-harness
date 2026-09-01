import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export function usesWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export function quoteWindowsCommand(command: string): string {
  return `"${command.replace(/"/g, '""')}"`;
}

export function quoteWindowsArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/^[a-zA-Z0-9_./:@\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

export function resolveSpawnExecutable(command: string): {
  executable: string;
  useShell: boolean;
} {
  if (process.platform !== "win32") {
    return { executable: command, useShell: false };
  }

  const candidates: string[] = [];
  if (existsSync(command)) {
    candidates.push(command);
  }

  const pathValue = process.env.PATH ?? "";
  const pathExt = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const hasExt = /\.[a-z0-9]+$/i.test(command);

  for (const dir of pathValue.split(";")) {
    if (!dir) continue;
    if (!hasExt) {
      for (const ext of pathExt) {
        candidates.push(join(dir, `${command}${ext}`));
      }
    }
    candidates.push(join(dir, command));
  }

  const found = candidates.find((candidate) => existsSync(candidate));
  const executable = found ?? command;
  return {
    executable,
    useShell: usesWindowsShell(executable),
  };
}

export function spawnCommand(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const resolved = resolveSpawnExecutable(command);
  if (resolved.useShell) {
    const line = [
      quoteWindowsCommand(resolved.executable),
      ...args.map(quoteWindowsArg),
    ].join(" ");
    return spawn(line, { ...options, shell: true });
  }
  return spawn(resolved.executable, args, options);
}

export function terminateChildTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    child.kill("SIGTERM");
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
