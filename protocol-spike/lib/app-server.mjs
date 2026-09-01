import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_COMMANDS = ["codex-harness", "codex"];

function officialVendorBinary(shimPath) {
  if (process.platform !== "win32") {
    return null;
  }
  const name = basename(shimPath).toLowerCase();
  if (name !== "codex" && name !== "codex.cmd" && name !== "codex.bat") {
    return null;
  }

  const nodeDir = dirname(shimPath);
  const triple =
    process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : "x86_64-pc-windows-msvc";
  const pkg =
    process.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
  const candidates = [
    join(
      nodeDir,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      pkg,
      "vendor",
      triple,
      "bin",
      "codex.exe",
    ),
    join(
      nodeDir,
      "node_modules",
      "@openai",
      "codex",
      "vendor",
      triple,
      "bin",
      "codex.exe",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function pathCandidates(commandName) {
  const pathValue = process.env.PATH ?? "";
  const paths = [];
  for (const dir of pathValue.split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    paths.push(join(dir, commandName));
    if (process.platform === "win32") {
      paths.push(join(dir, `${commandName}.exe`));
      paths.push(join(dir, `${commandName}.cmd`));
      paths.push(join(dir, `${commandName}.bat`));
    }
  }
  return paths;
}

function resolveCodexBin(explicit) {
  const requested = (explicit ?? process.env.CODEX_BIN ?? "").trim();
  const names = requested ? [requested] : DEFAULT_COMMANDS;
  for (const name of names) {
    const candidates = existsSync(name) ? [name] : pathCandidates(name);
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      return officialVendorBinary(candidate) ?? candidate;
    }
    if (existsSync(name)) {
      return officialVendorBinary(name) ?? name;
    }
  }
  return requested || DEFAULT_COMMANDS[0];
}

function usesWindowsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function quoteWindowsCommand(command) {
  return `"${command.replace(/"/g, '""')}"`;
}

function responseForApproval(method, mode) {
  if (mode === "accept") {
    if (method === "item/permissions/requestApproval") {
      return { permissions: {}, scope: "turn" };
    }
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      return { decision: "accept" };
    }
    if (method === "applyPatchApproval" || method === "execCommandApproval") {
      return { decision: "approved" };
    }
  }

  if (method === "item/permissions/requestApproval") {
    return { permissions: {}, scope: "turn" };
  }
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return { decision: "decline" };
  }
  if (method === "applyPatchApproval" || method === "execCommandApproval") {
    return { decision: { denied: { rejection: "protocol-spike auto-deny" } } };
  }

  return null;
}

export class AppServerClient extends EventEmitter {
  constructor({
    codexBin,
    cwd = process.cwd(),
    approvalMode = "decline",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log = (..._args) => {},
  } = {}) {
    super();
    this.codexBin = resolveCodexBin(codexBin);
    this.cwd = cwd;
    this.approvalMode = approvalMode;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.child = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.agentText = "";
    this.currentThreadId = null;
    this.currentTurnId = null;
    this.turnCompletions = [];
    this.onServerRequest = null;
    this.childError = null;
  }

  failPending(error) {
    this.childError = error;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.reject(error);
    }
  }

  start() {
    const useShell = usesWindowsShell(this.codexBin);
    this.child = useShell
      ? spawn(
          `${quoteWindowsCommand(this.codexBin)} app-server --stdio`,
          {
            cwd: this.cwd,
            env: process.env,
            stdio: ["pipe", "pipe", "inherit"],
            windowsHide: true,
            shell: true,
          },
        )
      : spawn(this.codexBin, ["app-server", "--stdio"], {
          cwd: this.cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "inherit"],
          windowsHide: true,
        });

    this.log("codex-bin", this.codexBin);

    this.child.on("error", (error) => {
      this.failPending(
        new Error(`failed to start ${this.codexBin}: ${error.message}`),
      );
      this.emit("childError", error);
    });

    this.child.on("exit", (code, signal) => {
      if (this.pending.size > 0) {
        this.failPending(
          new Error(
            `${this.codexBin} exited before handshake (code=${code}, signal=${signal})`,
          ),
        );
      }
      this.emit("exit", { code, signal });
    });

    const stdout = createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    stdout.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.log("invalid-json-line", { error: error.message, line });
        return;
      }

      this.handleMessage(message);
    });

    return this;
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rpc(method, params = {}) {
    if (this.childError) {
      return Promise.reject(this.childError);
    }
    const id = this.nextRequestId++;
    const envelope = { method, id, params };
    this.send(envelope);

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  notify(method, params = {}) {
    this.send({ method, params });
  }

  handleMessage(message) {
    if (message.method && message.id !== undefined) {
      this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params ?? {});
      return;
    }

    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) {
        this.log("unmatched-response", message);
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${JSON.stringify(message.error)}`));
      } else {
        entry.resolve(message.result);
      }
    }
  }

  handleServerRequest(message) {
    if (typeof this.onServerRequest === "function") {
      const handled = this.onServerRequest(message);
      if (handled !== undefined && handled !== null && handled !== false) {
        this.send({ id: message.id, result: handled });
        return;
      }
    }

    const result = responseForApproval(message.method, this.approvalMode);
    if (result === null) {
      this.log("unhandled-server-request", message);
      this.send({
        id: message.id,
        error: {
          code: -32601,
          message: `Method not implemented by protocol-spike: ${message.method}`,
        },
      });
      return;
    }

    this.log("server-request", {
      method: message.method,
      id: message.id,
      result,
    });
    this.send({ id: message.id, result });
  }

  handleNotification(method, params) {
    if (method === "thread/started") {
      this.currentThreadId = params.thread?.id ?? this.currentThreadId;
    }

    if (method === "turn/started") {
      this.currentTurnId = params.turn?.id ?? this.currentTurnId;
    }

    if (method === "item/agentMessage/delta") {
      this.agentText += params.delta ?? "";
    }

    if (method === "turn/completed") {
      this.turnCompletions.push(params);
    }

    this.emit("notification", { method, params });
    this.emit(method, params);
  }

  resetAgentText() {
    this.agentText = "";
  }

  async initialize(clientInfo) {
    await this.rpc("initialize", {
      clientInfo,
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  async startThread(params) {
    const result = await this.rpc("thread/start", params);
    this.currentThreadId = result.thread?.id ?? this.currentThreadId;
    return result;
  }

  async startTurn(params) {
    this.resetAgentText();
    this.turnCompletions = [];
    const result = await this.rpc("turn/start", params);
    this.currentTurnId = result.turn?.id ?? this.currentTurnId;
    return result;
  }

  waitForCondition(predicate, { timeoutMs = this.timeoutMs, intervalMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const tick = () => {
        const value = predicate();
        if (value) {
          resolve(value);
          return;
        }

        if (Date.now() > deadline) {
          reject(new Error(`condition not met within ${timeoutMs}ms`));
          return;
        }

        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  async waitForTurnCompletion({ timeoutMs = this.timeoutMs } = {}) {
    const completion = await this.waitForCondition(
      () => this.turnCompletions.at(-1),
      { timeoutMs },
    );
    return completion;
  }

  async interruptCurrentTurn() {
    return this.rpc("turn/interrupt", {
      threadId: this.currentThreadId,
      turnId: this.currentTurnId,
    });
  }

  close() {
    if (!this.child) {
      return;
    }
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    this.child.kill("SIGTERM");
  }
}
