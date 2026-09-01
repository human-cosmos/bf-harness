import { spawnSync, type ChildProcess } from "node:child_process";

export function usesWindowsShell(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

export function quoteWindowsCommand(command: string): string {
  return `"${command.replace(/"/g, '""')}"`;
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
