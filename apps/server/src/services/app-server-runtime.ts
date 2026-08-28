import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { terminateChildTree } from "./process-guard.js";

const localCodexBin = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../codex-harness/codex-rs/target/debug/codex",
);

export interface AppServerRuntimeOptions {
  codexBin?: string;
  cwd?: string;
  approvalMode?: "decline" | "accept";
  timeoutMs?: number;
  log?: (label: string, value?: unknown) => void;
}

export interface RuntimeMessage {
  method?: string;
  id?: number;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export interface ThreadStartInput {
  cwd: string;
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "on-request" | "never";
  approvalsReviewer?: "user" | "auto-review";
  ephemeral?: boolean;
  baseInstructions?: string;
  developerInstructions?: string;
}

export interface TurnStartInput {
  threadId: string;
  input: Array<{ type: "text"; text: string }>;
  outputSchema?: Record<string, unknown>;
  planMode?: boolean;
  approvalPolicy?: "on-request" | "never";
  approvalsReviewer?: "user" | "auto-review";
  sandboxPolicy?: {
    type: "readOnly" | "workspaceWrite" | "dangerFullAccess";
    networkAccess?: boolean;
    writableRoots?: string[];
    excludeTmpdirEnvVar?: boolean;
    excludeSlashTmp?: boolean;
  };
}

export interface TurnCompletion {
  turn?: { id?: string; status?: string };
}

export class AppServerRuntime extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      method: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private agentText = "";
  private turnCompletions: TurnCompletion[] = [];
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null =
    null;
  private spawnError: Error | null = null;

  readonly options: Required<
    Pick<AppServerRuntimeOptions, "codexBin" | "cwd" | "approvalMode" | "timeoutMs">
  > & { log: NonNullable<AppServerRuntimeOptions["log"]> };

  currentThreadId: string | null = null;
  currentTurnId: string | null = null;
  currentModel: string | null = null;
  onServerRequest:
    | ((
        message: RuntimeMessage,
      ) =>
        | unknown
        | false
        | null
        | undefined
        | Promise<unknown | false | null | undefined>)
    | null = null;

  constructor(options: AppServerRuntimeOptions = {}) {
    super();
    this.options = {
      codexBin:
        options.codexBin ??
        process.env.CODEX_BIN ??
        (existsSync(localCodexBin) ? localCodexBin : "codex-harness"),
      cwd: options.cwd ?? process.cwd(),
      approvalMode: options.approvalMode ?? "decline",
      timeoutMs: options.timeoutMs ?? 120_000,
      log: options.log ?? (() => {}),
    };
  }

  start(): this {
    const child = spawn(this.options.codexBin, ["app-server", "--stdio"], {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.child = child;

    child.on("error", (error) => {
      this.spawnError = error;
      this.rejectPending(error);
      this.emit("childError", error);
    });
    child.on("exit", (code, signal) => {
      this.exitInfo = { code, signal };
      this.rejectPending(
        new Error(`app-server exited with ${JSON.stringify({ code, signal })}`),
      );
      this.emit("exit", { code, signal });
    });

    if (child.stdout) {
      createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      }).on("line", (line) => {
        if (!line.trim()) {
          return;
        }
        try {
          this.handleMessage(JSON.parse(line) as RuntimeMessage);
        } catch (error) {
          this.options.log("invalid-json-line", {
            error: (error as Error).message,
            line,
          });
        }
      });
    }

    return this;
  }

  send(message: Record<string, unknown>): void {
    if (!this.child || !this.child.stdin) {
      throw new Error("AppServerRuntime is not started");
    }
    if (this.spawnError) {
      throw new Error(
        `AppServerRuntime failed to start: ${this.spawnError.message}`,
      );
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rpc(method: string, params: unknown = {}): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      this.pending.set(id, { resolve, reject, method, timer });
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.send({ method, params });
  }

  async initialize(clientInfo: {
    name: string;
    title: string;
    version: string;
  }): Promise<void> {
    await this.rpc("initialize", {
      clientInfo,
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  async startThread(input: ThreadStartInput): Promise<unknown> {
    const result = await this.rpc("thread/start", {
      cwd: input.cwd,
      sandbox: input.sandbox,
      approvalPolicy: input.approvalPolicy ?? "on-request",
      approvalsReviewer: input.approvalsReviewer ?? "user",
      ephemeral: input.ephemeral ?? false,
      baseInstructions: input.baseInstructions,
      developerInstructions: input.developerInstructions,
    });
    this.currentThreadId =
      (result as { thread?: { id?: string } })?.thread?.id ?? this.currentThreadId;
    this.currentModel =
      (result as { model?: string | null })?.model ?? this.currentModel;
    return result;
  }

  async resumeThread(
    threadId: string,
    overrides: {
      approvalPolicy?: "on-request" | "never";
      approvalsReviewer?: "user" | "auto-review";
      baseInstructions?: string;
      developerInstructions?: string;
    } = {},
  ): Promise<unknown> {
    const result = await this.rpc("thread/resume", {
      threadId,
      approvalPolicy: overrides.approvalPolicy ?? "on-request",
      approvalsReviewer: overrides.approvalsReviewer ?? "user",
      baseInstructions: overrides.baseInstructions,
      developerInstructions: overrides.developerInstructions,
    });
    this.currentThreadId =
      (result as { thread?: { id?: string } })?.thread?.id ?? threadId;
    return result;
  }

  async startTurn(input: TurnStartInput): Promise<unknown> {
    this.agentText = "";
    this.turnCompletions = [];
    let collaborationMode: Record<string, unknown> | undefined;
    if (input.planMode) {
      if (!this.currentModel) {
        throw new Error("Cannot start a plan-mode turn before a model is known");
      }
      collaborationMode = {
        mode: "plan",
        settings: {
          model: this.currentModel,
          reasoning_effort: null,
          developer_instructions: null,
        },
      };
    }
    const result = await this.rpc("turn/start", {
      threadId: input.threadId,
      input: input.input,
      outputSchema: input.outputSchema,
      collaborationMode,
      approvalPolicy: input.approvalPolicy ?? "on-request",
      approvalsReviewer: input.approvalsReviewer ?? "user",
      sandboxPolicy: input.sandboxPolicy,
    });
    this.currentTurnId =
      (result as { turn?: { id?: string } })?.turn?.id ?? this.currentTurnId;
    return result;
  }

  async interrupt(threadId: string, turnId: string): Promise<unknown> {
    return this.rpc("turn/interrupt", { threadId, turnId });
  }

  async waitForTurnCompletion(
    timeoutMs: number | null = this.options.timeoutMs,
  ): Promise<TurnCompletion> {
    const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;
    while (this.turnCompletions.length === 0) {
      if (this.spawnError) {
        throw new Error(
          `app-server failed to start: ${this.spawnError.message}`,
        );
      }
      if (this.exitInfo) {
        throw new Error(
          `app-server exited before turn completion: ${JSON.stringify(this.exitInfo)}`,
        );
      }
      if (deadline !== null && Date.now() > deadline) {
        throw new Error(`turn did not complete within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.turnCompletions.at(-1)!;
  }

  getAgentText(): string {
    return this.agentText;
  }

  close(): void {
    if (!this.child) {
      return;
    }
    this.child.stdin?.end();
    terminateChildTree(this.child);
  }

  private handleMessage(message: RuntimeMessage): void {
    if (message.method && message.id !== undefined) {
      void this.handleServerRequest(message);
      return;
    }
    if (message.method) {
      this.handleNotification(message.method, message.params);
      return;
    }
    if (message.id !== undefined) {
      this.handleResponse(message);
    }
  }

  private handleResponse(message: RuntimeMessage): void {
    const entry = this.pending.get(message.id!);
    if (!entry) {
      this.options.log("unmatched-response", message);
      return;
    }
    this.pending.delete(message.id!);
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(new Error(`${entry.method}: ${JSON.stringify(message.error)}`));
    } else {
      entry.resolve(message.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private async handleServerRequest(message: RuntimeMessage): Promise<void> {
    try {
      if (this.onServerRequest) {
        const custom = await this.onServerRequest(message);
        if (custom !== undefined && custom !== null && custom !== false) {
          this.send({ id: message.id!, result: custom });
          return;
        }
      }

      const result = this.defaultApprovalResponse(message.method ?? "");
      if (result === null) {
        this.options.log("unhandled-server-request", message);
        this.send({
          id: message.id!,
          error: {
            code: -32601,
            message: `Method not implemented: ${message.method}`,
          },
        });
        return;
      }

      this.options.log("server-request", {
        method: message.method,
        id: message.id,
        result,
      });
      this.send({ id: message.id!, result });
    } catch (error) {
      this.options.log("server-request-error", {
        method: message.method,
        id: message.id,
        error: (error as Error).message,
      });
      this.send({
        id: message.id!,
        error: {
          code: -32603,
          message: (error as Error).message,
        },
      });
    }
  }

  private defaultApprovalResponse(method: string): unknown {
    if (method === "item/permissions/requestApproval") {
      return { permissions: {}, scope: "turn" };
    }
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      return { decision: this.options.approvalMode };
    }
    if (method === "applyPatchApproval" || method === "execCommandApproval") {
      return {
        decision:
          this.options.approvalMode === "accept"
            ? "approved"
            : { denied: { rejection: "runtime auto-deny" } },
      };
    }
    return null;
  }

  private handleNotification(method: string, params: unknown): void {
    const data = (params ?? {}) as Record<string, unknown>;
    if (method === "thread/started") {
      this.currentThreadId =
        (data.thread as { id?: string } | undefined)?.id ?? this.currentThreadId;
    }
    if (method === "turn/started") {
      this.currentTurnId =
        (data.turn as { id?: string } | undefined)?.id ?? this.currentTurnId;
    }
    if (method === "item/agentMessage/delta") {
      this.agentText += String(data.delta ?? "");
    }
    if (method === "turn/completed") {
      this.turnCompletions.push(data as TurnCompletion);
    }

    this.emit("notification", { method, params: data });
    this.emit(method, data);
  }
}
