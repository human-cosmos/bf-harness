import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const runtimeDir = join(rootDir, ".run");
const logsDir = join(runtimeDir, "logs");

const SERVICES = {
  server: {
    id: "server",
    packageName: "@bugfix-harness/server",
    label: "后端 server",
    logFile: "server.log",
    pidFile: "server.pid",
    url: "http://127.0.0.1:4317/api/health",
  },
  web: {
    id: "web",
    packageName: "@bugfix-harness/web",
    label: "前端 web",
    logFile: "web.log",
    pidFile: "web.pid",
    url: "http://127.0.0.1:4318",
  },
};

const ACTION_NAMES = {
  start: "启动",
  stop: "停止",
  restart: "重启",
  status: "状态",
};

function usage() {
  console.log(`用法：
  node scripts/services.mjs <start|stop|restart|status> [server|web|all]
  ./scripts/services.sh <start|stop|restart|status> [server|web|all]   # macOS/Linux
  scripts\\services.cmd <start|stop|restart|status> [server|web|all]    # Windows

命令：
  start    启动服务（默认前后端一起启动）
  stop     停止服务
  restart  重启服务
  status   查看服务状态

服务：
  all             默认值，同时操作前后端
  server/backend  后端服务（http://127.0.0.1:4317）
  web/frontend    前端服务（http://127.0.0.1:4318）

日志目录：${logsDir}`);
}

function normalizeService(value) {
  switch ((value ?? "all").toLowerCase()) {
    case "all":
      return ["server", "web"];
    case "server":
    case "backend":
      return ["server"];
    case "web":
    case "frontend":
      return ["web"];
    default:
      return null;
  }
}

function parseArgs(argv) {
  const [action, target] = argv.slice(2);
  if (!action || action === "-h" || action === "--help" || action === "help") {
    usage();
    process.exit(action ? 0 : 1);
  }

  const normalizedAction = action.toLowerCase();
  if (!(normalizedAction in ACTION_NAMES)) {
    console.error(`未知命令：${action}`);
    usage();
    process.exit(1);
  }

  const targets = normalizeService(target);
  if (!targets) {
    console.error(`未知服务：${target}`);
    usage();
    process.exit(1);
  }

  return { action: normalizedAction, targets };
}

function pidPath(service) {
  return join(runtimeDir, service.pidFile);
}

function logPath(service) {
  return join(logsDir, service.logFile);
}

function readPid(service) {
  const path = pidPath(service);
  if (!existsSync(path)) {
    return null;
  }

  const text = readFileSync(path, "utf8").trim();
  const pid = Number.parseInt(text, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function writePid(service, pid) {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(pidPath(service), `${pid}\n`, "utf8");
}

function findWindowsDescendantPid(parentPid, marker) {
  const escapedMarker = marker.replaceAll("'", "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -like '*${escapedMarker}*' } | Select-Object -First 1 -ExpandProperty ProcessId`;

  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 5000 },
    ).trim();
    const pid = Number.parseInt(output, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function removePid(service) {
  rmSync(pidPath(service), { force: true });
}

function spawnService(service) {
  mkdirSync(logsDir, { recursive: true });
  const logFd = openSync(logPath(service), "a");
  const args = ["--filter", service.packageName, "dev"];

  const options = {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  };

  const child =
    process.platform === "win32"
      ? spawn(
          "cmd.exe",
          ["/d", "/s", "/c", `pnpm ${args.map(quoteWindowsArg).join(" ")}`],
          options,
        )
      : spawn("pnpm", args, { ...options, detached: true });

  closeSync(logFd);
  return child;
}

function quoteWindowsArg(value) {
  if (/^[a-zA-Z0-9_./:@\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function startService(service) {
  const existingPid = readPid(service);
  if (existingPid && isRunning(existingPid)) {
    console.log(`[${service.label}] 已在运行（PID ${existingPid}）`);
    return true;
  }

  if (existingPid) {
    removePid(service);
  }

  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const child = spawnService(service);
  let trackedPid = null;
  if (process.platform === "win32") {
    for (let attempt = 0; attempt < 50 && !trackedPid; attempt += 1) {
      trackedPid = findWindowsDescendantPid(child.pid, service.packageName);
      if (!trackedPid) {
        await delay(100);
      }
    }
  }
  const pidToWrite = trackedPid || child.pid;
  writePid(service, pidToWrite);

  const error = await new Promise((resolveError) => {
    let settled = false;
    child.once("error", (err) => {
      if (!settled) {
        settled = true;
        resolveError(err);
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        resolveError(null);
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolveError(null);
      }
    }, 2000);
  });

  if (error) {
    removePid(service);
    console.error(`[${service.label}] 启动失败：${error.message}`);
    return false;
  }

  child.unref();
  console.log(`[${service.label}] 已启动（PID ${pidToWrite}），地址：${service.url}`);
  console.log(`[${service.label}] 日志：${logPath(service)}`);
  return true;
}

function runCommand(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolveRun(false));
    child.once("exit", (code) => resolveRun(code === 0));
  });
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(pid)) {
      return true;
    }
    await delay(100);
  }
  return !isRunning(pid);
}

async function stopService(service) {
  const pid = readPid(service);
  if (!pid) {
    console.log(`[${service.label}] 未运行`);
    return true;
  }

  if (!isRunning(pid)) {
    removePid(service);
    console.log(`[${service.label}] 未运行`);
    return true;
  }

  console.log(`[${service.label}] 正在停止（PID ${pid}）...`);

  let stopped = false;
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
    stopped = await waitForExit(pid, 3000);
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // 进程可能刚好退出，忽略。
      }
    }

    stopped = await waitForExit(pid, 3000);
    if (!stopped) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // 忽略。
        }
      }
      stopped = await waitForExit(pid, 1500);
    }
  }

  if (stopped) {
    removePid(service);
    console.log(`[${service.label}] 已停止`);
  } else {
    console.warn(`[${service.label}] 未能确认停止，请检查 PID ${pid} 及其子进程`);
  }

  return stopped;
}

function statusService(service) {
  const pid = readPid(service);
  if (pid && isRunning(pid)) {
    console.log(`[${service.label}] 运行中（PID ${pid}）`);
  } else {
    console.log(`[${service.label}] 已停止`);
  }
}

async function main() {
  const { action, targets } = parseArgs(process.argv);
  const services = targets.map((id) => SERVICES[id]);

  if (action === "status") {
    for (const service of services) {
      statusService(service);
    }
    return;
  }

  if (action === "restart") {
    for (const service of services) {
      await stopService(service);
    }
    await delay(300);
    for (const service of services) {
      await startService(service);
    }
    return;
  }

  if (action === "stop") {
    for (const service of services) {
      await stopService(service);
    }
    return;
  }

  if (action === "start") {
    for (const service of services) {
      await startService(service);
    }
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
