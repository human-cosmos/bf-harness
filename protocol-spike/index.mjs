import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const CODEX_BIN = process.env.CODEX_BIN || "codex-harness";
const PROMPT =
  process.argv.slice(2).join(" ").trim() ||
  "Reply with exactly: SPIKE_OK";
const WORKSPACE = process.env.SPIKE_WORKSPACE || process.cwd();
const TIMEOUT_MS = Number(process.env.SPIKE_TIMEOUT_MS || 120_000);

const child = spawn(CODEX_BIN, ["app-server", "--stdio"], {
  cwd: WORKSPACE,
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
  windowsHide: true,
});

let nextRequestId = 1;
let currentThreadId = null;
let currentTurnId = null;
let turnFinished = false;

const pending = new Map();

function log(label, value) {
  const suffix = value === undefined ? "" : ` ${JSON.stringify(value)}`;
  console.log(`[spike] ${label}${suffix}`);
}

function sendMessage(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function rpc(method, params) {
  const id = nextRequestId++;
  const envelope = { method, id, params };
  sendMessage(envelope);

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
  });
}

function notify(method, params = {}) {
  sendMessage({ method, params });
}

function resolveServerRequest(message) {
  const responders = {
    "item/commandExecution/requestApproval": () => ({ decision: "decline" }),
    "item/fileChange/requestApproval": () => ({ decision: "decline" }),
    "item/permissions/requestApproval": () => ({
      permissions: {},
      scope: "turn",
    }),
    applyPatchApproval: () => ({
      decision: { denied: { rejection: "protocol-spike auto-deny" } },
    }),
    execCommandApproval: () => ({
      decision: { denied: { rejection: "protocol-spike auto-deny" } },
    }),
  };

  const respond = responders[message.method];
  if (!respond) {
    log("unhandled-server-request", { id: message.id, method: message.method });
    sendMessage({
      id: message.id,
      error: {
        code: -32601,
        message: `Method not implemented by protocol-spike: ${message.method}`,
      },
    });
    return;
  }

  const result = respond();
  log("server-request", {
    method: message.method,
    id: message.id,
    result,
  });
  sendMessage({ id: message.id, result });
}

function handleNotification(message) {
  const { method, params = {} } = message;

  if (method === "thread/started") {
    currentThreadId = params.thread?.id ?? currentThreadId;
    log("thread-started", { threadId: currentThreadId });
    return;
  }

  if (method === "turn/started") {
    currentTurnId = params.turn?.id ?? currentTurnId;
    log("turn-started", { turnId: currentTurnId });
    return;
  }

  if (method === "turn/completed") {
    turnFinished = true;
    log("turn-completed", {
      turnId: params.turn?.id,
      status: params.turn?.status,
    });
    return;
  }

  if (method === "item/agentMessage/delta") {
    process.stdout.write(params.delta ?? "");
    return;
  }

  if (method === "item/completed") {
    log("item-completed", {
      itemId: params.item?.id,
      type: params.item?.type,
    });
    return;
  }

  if (method === "error") {
    log("server-error", params);
  }
}

function handleLine(line) {
  if (!line.trim()) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    log("invalid-json-line", { error: error.message, line });
    return;
  }

  if (message.method && message.id !== undefined) {
    resolveServerRequest(message);
    return;
  }

  if (message.method) {
    handleNotification(message);
    return;
  }

  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    if (!entry) {
      log("unmatched-response", message);
      return;
    }

    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(`${entry.method}: ${JSON.stringify(message.error)}`));
    } else {
      entry.resolve(message.result);
    }
  }
}

const stdout = createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
});

stdout.on("line", handleLine);

child.on("error", (error) => {
  console.error(`[spike] failed to start ${CODEX_BIN}: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (!turnFinished) {
    console.error(`[spike] app-server exited before turn completion: code=${code} signal=${signal}`);
    process.exitCode = process.exitCode ?? 2;
  }
});

async function main() {
  const timeout = setTimeout(() => {
    console.error(`[spike] timed out after ${TIMEOUT_MS}ms`);
    child.kill("SIGTERM");
    process.exitCode = 2;
  }, TIMEOUT_MS);

  try {
    await rpc("initialize", {
      clientInfo: {
        name: "bugfix-harness-protocol-spike",
        title: "Bugfix Harness Protocol Spike",
        version: "0.1.0",
      },
    });
    notify("initialized");

    const started = await rpc("thread/start", {
      cwd: WORKSPACE,
      sandbox: "read-only",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      ephemeral: false,
      baseInstructions:
        "You are running in a bugfix-harness protocol spike. Keep the response minimal.",
    });

    currentThreadId = started.thread?.id ?? currentThreadId;
    log("thread-created", { threadId: currentThreadId, model: started.model });

    const turn = await rpc("turn/start", {
      threadId: currentThreadId,
      input: [{ type: "text", text: PROMPT }],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    });

    currentTurnId = turn.turn?.id ?? currentTurnId;
    log("turn-created", { turnId: currentTurnId });
  } catch (error) {
    console.error(`[spike] request failed: ${error.message}`);
    child.kill("SIGTERM");
    process.exitCode = 1;
    return;
  }

  while (!turnFinished && !child.killed && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  clearTimeout(timeout);
  process.stdout.write("\n");
  log("complete", {
    threadId: currentThreadId,
    turnId: currentTurnId,
    finished: turnFinished,
  });

  child.stdin.end();
  child.kill("SIGTERM");
}

main();
