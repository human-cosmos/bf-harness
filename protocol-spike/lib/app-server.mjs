import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

const DEFAULT_TIMEOUT_MS = 120_000;

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
    codexBin = "codex-harness",
    cwd = process.cwd(),
    approvalMode = "decline",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log = (..._args) => {},
  } = {}) {
    super();
    this.codexBin = codexBin;
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
  }

  start() {
    this.child = spawn(this.codexBin, ["app-server", "--stdio"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });

    this.child.on("error", (error) => {
      this.emit("childError", error);
    });

    this.child.on("exit", (code, signal) => {
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
    await this.rpc("initialize", { clientInfo });
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
