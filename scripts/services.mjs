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
import { networkInterfaces } from "node:os";
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

function servicePort(service) {
  return Number(new URL(service.url).port);
}

function findListeningPid(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  try {
    if (process.platform === "win32") {
      const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
        encoding: "utf8",
        windowsHide: true,
      });
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) {
          continue;
        }
        const columns = line.trim().split(/\s+/);
        const local = columns[1] ?? "";
        const localPort = Number.parseInt(local.split(":").at(-1) ?? "", 10);
        if (localPort !== port) {
          continue;
        }
        const pid = Number.parseInt(columns.at(-1) ?? "", 10);
        if (Number.isInteger(pid) && pid > 0) {
          return pid;
        }
      }
      return null;
    }

    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    }).trim();
    const pid = Number.parseInt(output.split(/\s+/)[0] ?? "", 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
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

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function accessUrls(service) {
  const port = servicePort(service);
  const path = new URL(service.url).pathname === "/" ? "" : new URL(service.url).pathname;
  const urls = [`http://127.0.0.1:${port}${path}`, `http://localhost:${port}${path}`];
  for (const address of lanAddresses()) {
    urls.push(`http://${address}:${port}${path}`);
  }
  return urls;
}

function logAccessUrls(service) {
  for (const url of accessUrls(service)) {
    console.log(`[${service.label}] 访问：${url}`);
  }
}

function spawnService(service) {
  mkdirSync(logsDir, { recursive: true });
  const logFd = openSync(logPath(service), "a");
  const args = ["--filter", service.packageName, "dev"];
  const env = { ...process.env };
  if (service.id === "server") {
    env.BUGFIX_HARNESS_HOST = process.env.BUGFIX_HARNESS_HOST ?? "0.0.0.0";
  }

  const options = {
    cwd: rootDir,
    env,
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

async function isHealthy(service) {
  try {
    const response = await fetch(service.url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(service, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(service)) {
      return true;
    }
    await delay(250);
  }
  return false;
}

async function killPid(pid) {
  if (!pid || !isRunning(pid)) {
    return true;
  }
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  }
  return waitForExit(pid, 3000);
}

function processCommandLine(pid) {
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" | Select-Object -ExpandProperty CommandLine`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      ).trim();
      return output || null;
    }
    if (process.platform === "linux") {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .replace(/\0/g, " ")
        .trim();
      if (cmdline) {
        return cmdline;
      }
    }
    const output = execFileSync(
      "ps",
      ["-ww", "-p", String(pid), "-o", "command="],
      { encoding: "utf8" },
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

function processLooksLikeOurs(pid, service) {
  const commandLine = processCommandLine(pid);
  if (!commandLine) {
    return false;
  }
  const normalized = commandLine.replace(/\\/g, "/").toLowerCase();
  const root = rootDir.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes(service.packageName.toLowerCase()) ||
    normalized.includes(root)
  );
}

async function adoptOrClearPort(service) {
  const port = servicePort(service);
  const listeningPid = findListeningPid(port);
  if (!listeningPid) {
    return null;
  }
  if (await isHealthy(service)) {
    if (!processLooksLikeOurs(listeningPid, service)) {
      throw new Error(
        `端口 ${port} 被其他健康服务占用（PID ${listeningPid}），不会接管`,
      );
    }
    writePid(service, listeningPid);
    return listeningPid;
  }
  if (!processLooksLikeOurs(listeningPid, service)) {
    throw new Error(
      `端口 ${port} 被其他程序占用（PID ${listeningPid}），请先手动释放`,
    );
  }
  console.log(`[${service.label}] 端口 ${port} 被本项目的旧进程 PID ${listeningPid} 占用，正在清理`);
  await killPid(listeningPid);
  return null;
}

async function startService(service) {
  const existingPid = readPid(service);
  if (existingPid && isRunning(existingPid) && (await isHealthy(service))) {
    console.log(`[${service.label}] 已在运行（PID ${existingPid}）`);
    return true;
  }

  if (existingPid) {
    if (isRunning(existingPid) && !(await isHealthy(service))) {
      if (processLooksLikeOurs(existingPid, service)) {
        await killPid(existingPid);
      } else {
        console.warn(
          `[${service.label}] PID 文件指向的 PID ${existingPid} 不属于本项目，已跳过停止`,
        );
      }
    }
    removePid(service);
  }

  const adopted = await adoptOrClearPort(service);
  if (adopted) {
    console.log(`[${service.label}] 已在运行（PID ${adopted}）`);
    logAccessUrls(service);
    return true;
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
  const healthy = await waitForHealthy(service);
  const listeningPid = findListeningPid(servicePort(service));
  if (listeningPid) {
    writePid(service, listeningPid);
  }
  if (!healthy) {
    console.error(`[${service.label}] 已启动但未在超时内变为健康：${service.url}`);
    console.error(`[${service.label}] 日志：${logPath(service)}`);
    await killPid(pidToWrite);
    const orphan = findListeningPid(servicePort(service));
    if (orphan && orphan !== pidToWrite && isRunning(orphan)) {
      if (processLooksLikeOurs(orphan, service)) {
        await killPid(orphan);
      } else {
        console.warn(
          `[${service.label}] 端口上的残留进程 PID ${orphan} 不属于本项目，保留现场`,
        );
      }
    }
    removePid(service);
    return false;
  }
  console.log(`[${service.label}] 已启动（PID ${listeningPid || pidToWrite}）`);
  logAccessUrls(service);
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
  const port = servicePort(service);
  const pid = readPid(service);
  const listener = findListeningPid(port);
  const targetPid = pid ?? listener;
  if (!targetPid && !listener) {
    removePid(service);
    console.log(`[${service.label}] 未运行`);
    return true;
  }

  if (targetPid && isRunning(targetPid)) {
    if (!processLooksLikeOurs(targetPid, service)) {
      console.warn(
        `[${service.label}] PID ${targetPid} 不属于本项目，已跳过停止`,
      );
      if (listener && listener !== targetPid && processLooksLikeOurs(listener, service)) {
        await killPid(listener);
        removePid(service);
        return true;
      }
      removePid(service);
      return false;
    }

    console.log(`[${service.label}] 正在停止（PID ${targetPid}）...`);
    const stopped = await killPid(targetPid);
    const leftover = findListeningPid(port);
    if (leftover && leftover !== targetPid) {
      if (processLooksLikeOurs(leftover, service)) {
        await killPid(leftover);
      } else {
        console.warn(
          `[${service.label}] 端口 ${port} 上的残留进程 PID ${leftover} 不属于本项目，未停止`,
        );
      }
    }

    if (stopped && !findListeningPid(port)) {
      removePid(service);
      console.log(`[${service.label}] 已停止`);
      return true;
    }

    console.warn(`[${service.label}] 未能确认停止，请检查 PID ${targetPid} 及其子进程`);
    return false;
  }

  if (listener) {
    if (!processLooksLikeOurs(listener, service)) {
      console.warn(
        `[${service.label}] 端口 ${port} 上的进程 PID ${listener} 不属于本项目，未停止`,
      );
      removePid(service);
      return false;
    }
    console.log(`[${service.label}] 正在停止端口 ${port} 上的残留进程（PID ${listener}）...`);
    const stoppedLeftover = await killPid(listener);
    removePid(service);
    return stoppedLeftover;
  }

  removePid(service);
  console.log(`[${service.label}] 未运行`);
  return true;
}

function statusService(service) {
  const port = servicePort(service);
  const pid = readPid(service);
  const listeningPid = findListeningPid(port);
  if (pid && isRunning(pid)) {
    console.log(`[${service.label}] 运行中（PID ${pid}）`);
    logAccessUrls(service);
    return;
  }
  if (listeningPid) {
    console.log(`[${service.label}] 运行中（端口 ${port} / PID ${listeningPid}，PID 文件缺失或过期）`);
    logAccessUrls(service);
    return;
  }
  console.log(`[${service.label}] 已停止`);
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
    let ok = true;
    for (const service of services) {
      ok = (await stopService(service)) && ok;
    }
    await delay(300);
    for (const service of services) {
      ok = (await startService(service)) && ok;
    }
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (action === "stop") {
    let ok = true;
    for (const service of services) {
      ok = (await stopService(service)) && ok;
    }
    process.exitCode = ok ? 0 : 1;
    return;
  }

  if (action === "start") {
    let ok = true;
    for (const service of services) {
      ok = (await startService(service)) && ok;
    }
    process.exitCode = ok ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
