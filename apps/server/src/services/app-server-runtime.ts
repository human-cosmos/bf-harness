import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  quoteWindowsCommand,
  terminateChildTree,
  usesWindowsShell,
} from "./process-guard.js";
import { resolveAvailableCodexBin } from "./codex-runtime-service.js";

const localCodexBin = join(
  import.meta.url ? dirname(fileURLToPath(import.meta.url)) : process.cwd(),
  "../../../codex-harness/codex-rs/target/debug/codex",
);

export interface AppServerRuntimeOptions {
  codexBin?: string;
  cwd?: string;
  approvalMode?: "decline" | "accept";
  timeoutMs?: number;
  turnIdleTimeoutMs?: number | null;
  turnMaxTimeoutMs?: number | null;
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
  approvalPolicy?: "on-request" | "never" | "untrusted" | "granular";
  approvalsReviewer?: "user" | "auto-review" | "auto_review" | "guardian_subagent";
  ephemeral?: boolean;
  baseInstructions?: string;
  developerInstructions?: string;
}

export interface TurnStartInput {
  threadId: string;
  input: unknown[];
  outputSchema?: Record<string, unknown>;
  planMode?: boolean;
  approvalPolicy?: "on-request" | "never" | "untrusted" | "granular";
  approvalsReviewer?: "user" | "auto-review" | "auto_review" | "guardian_subagent";
  model?: string | null;
  effort?: string | null;
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

export interface TurnCompletionWaitOptions {
  idleTimeoutMs?: number | null;
  maxTimeoutMs?: number | null;
}

function isUnknownRpcMethod(error: unknown, method: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(`unknown variant \`${method}\``) ||
    message.includes("Method not found")
  );
}

function isUnsupportedRpcMethod(error: unknown, method: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(method) && message.includes("not supported yet");
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
  private readonly pendingServerRequestIds = new Set<number>();
  private turnActiveStartedAt: number | null = null;
  private turnWaitingStartedAt: number | null = null;
  private turnAccumulatedActiveMs = 0;
  private lastTurnActivityAt = 0;

  readonly options: Required<
    Pick<
      AppServerRuntimeOptions,
      | "codexBin"
      | "cwd"
      | "approvalMode"
      | "timeoutMs"
      | "turnIdleTimeoutMs"
      | "turnMaxTimeoutMs"
    >
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
        resolveAvailableCodexBin() ??
        (existsSync(localCodexBin) ? localCodexBin : "codex-harness"),
      cwd: options.cwd ?? process.cwd(),
      approvalMode: options.approvalMode ?? "decline",
      timeoutMs: options.timeoutMs ?? 120_000,
      turnIdleTimeoutMs:
        options.turnIdleTimeoutMs ?? options.timeoutMs ?? 120_000,
      turnMaxTimeoutMs: options.turnMaxTimeoutMs ?? null,
      log: options.log ?? (() => {}),
    };
  }

  start(): this {
    const useShell = usesWindowsShell(this.options.codexBin);
    const child = useShell
      ? spawn(
          `${quoteWindowsCommand(this.options.codexBin)} app-server --stdio`,
          {
            cwd: this.options.cwd,
            env: process.env,
            stdio: ["pipe", "pipe", "inherit"],
            windowsHide: true,
            detached: false,
            shell: true,
          },
        )
      : spawn(this.options.codexBin, ["app-server", "--stdio"], {
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
      approvalPolicy?: "on-request" | "never" | "untrusted" | "granular";
      approvalsReviewer?: "user" | "auto-review" | "auto_review" | "guardian_subagent";
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
    this.resetTurnClock();
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
      model: input.model,
      effort: input.effort,
      sandboxPolicy: input.sandboxPolicy,
    });
    this.currentTurnId =
      (result as { turn?: { id?: string } })?.turn?.id ?? this.currentTurnId;
    return result;
  }

  async interrupt(threadId: string, turnId: string): Promise<unknown> {
    return this.rpc("turn/interrupt", { threadId, turnId });
  }

  async steerTurn(
    threadId: string,
    turnId: string,
    input: unknown[],
  ): Promise<unknown> {
    return this.rpc("turn/steer", { threadId, turnId, input });
  }

  async readThread(
    threadId: string,
    includeTurns = false,
  ): Promise<unknown> {
    return this.rpc("thread/read", { threadId, includeTurns });
  }

  async listTurns(
    threadId: string,
    options: {
      cursor?: string | null;
      limit?: number | null;
      sortDirection?: "asc" | "desc" | null;
    } = {},
  ): Promise<unknown> {
    return this.rpc("thread/turns/list", {
      threadId,
      cursor: options.cursor ?? null,
      limit: options.limit ?? null,
      sortDirection: options.sortDirection ?? null,
    });
  }

  async listItems(
    threadId: string,
    options: {
      turnId?: string | null;
      cursor?: string | null;
      limit?: number | null;
      sortDirection?: "asc" | "desc" | null;
    } = {},
  ): Promise<unknown> {
    const params = {
      threadId,
      turnId: options.turnId ?? null,
      cursor: options.cursor ?? null,
      limit: options.limit ?? null,
      sortDirection: options.sortDirection ?? null,
    };
    try {
      return await this.rpc("thread/turns/items/list", params);
    } catch (error) {
      if (
        !isUnknownRpcMethod(error, "thread/turns/items/list") &&
        !isUnsupportedRpcMethod(error, "thread/turns/items/list")
      ) {
        throw error;
      }
      return this.rpc("thread/items/list", params);
    }
  }

  async forkThread(
    threadId: string,
    options: { lastTurnId?: string | null; excludeTurns?: boolean } = {},
  ): Promise<unknown> {
    return this.rpc("thread/fork", {
      threadId,
      lastTurnId: options.lastTurnId ?? null,
      excludeTurns: options.excludeTurns ?? false,
    });
  }

  async archiveThread(threadId: string): Promise<unknown> {
    return this.rpc("thread/archive", { threadId });
  }

  async getConversationSummary(threadId: string): Promise<unknown> {
    return this.rpc("getConversationSummary", { conversationId: threadId });
  }

  async setThreadName(threadId: string, name: string): Promise<unknown> {
    return this.rpc("thread/name/set", { threadId, name });
  }

  async compactThread(threadId: string): Promise<unknown> {
    return this.rpc("thread/compact/start", { threadId });
  }

  async listModels(options: { limit?: number | null } = {}): Promise<unknown> {
    return this.rpc("model/list", {
      cursor: null,
      limit: options.limit ?? null,
      includeHidden: false,
    });
  }

  async fuzzyFileSearch(
    params: { cwd?: string; query: string },
  ): Promise<unknown> {
    return this.rpc("fuzzyFileSearch", {
      ...params,
    });
  }

  async waitForTurnCompletion(
    timeoutOrOptions:
      | number
      | null
      | TurnCompletionWaitOptions
      | undefined,
  ): Promise<TurnCompletion> {
    const options: TurnCompletionWaitOptions =
      timeoutOrOptions === undefined
        ? {
            idleTimeoutMs: this.options.turnIdleTimeoutMs,
            maxTimeoutMs: this.options.turnMaxTimeoutMs,
          }
        : typeof timeoutOrOptions === "number" || timeoutOrOptions === null
          ? { idleTimeoutMs: timeoutOrOptions, maxTimeoutMs: null }
          : timeoutOrOptions;
    const idleTimeoutMs =
      options.idleTimeoutMs === undefined
        ? this.options.turnIdleTimeoutMs
        : options.idleTimeoutMs;
    const maxTimeoutMs = options.maxTimeoutMs ?? null;

    this.ensureTurnClockStarted();
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

      this.refreshTurnClock();
      const waitingForServerRequest = this.pendingServerRequestIds.size > 0;
      if (
        !waitingForServerRequest &&
        idleTimeoutMs !== null &&
        this.lastTurnActivityAt > 0 &&
        Date.now() - this.lastTurnActivityAt > idleTimeoutMs
      ) {
        throw new Error(
          `turn did not complete within ${idleTimeoutMs}ms of activity`,
        );
      }
      if (
        maxTimeoutMs !== null &&
        this.getTurnActiveElapsedMs() > maxTimeoutMs
      ) {
        throw new Error(
          `turn exceeded the ${maxTimeoutMs}ms maximum active duration`,
        );
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
    this.markTurnActivity();
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
    this.pendingServerRequestIds.add(message.id!);
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
    } finally {
      this.pendingServerRequestIds.delete(message.id!);
      this.markTurnActivity();
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

  private resetTurnClock(): void {
    const now = Date.now();
    this.turnAccumulatedActiveMs = 0;
    this.turnActiveStartedAt = now;
    this.turnWaitingStartedAt = null;
    this.lastTurnActivityAt = now;
  }

  private ensureTurnClockStarted(): void {
    if (this.lastTurnActivityAt === 0) {
      this.resetTurnClock();
    }
  }

  private markTurnActivity(): void {
    this.lastTurnActivityAt = Date.now();
  }

  private refreshTurnClock(): void {
    const now = Date.now();
    if (this.pendingServerRequestIds.size > 0) {
      if (this.turnActiveStartedAt !== null) {
        this.turnAccumulatedActiveMs += now - this.turnActiveStartedAt;
        this.turnActiveStartedAt = null;
      }
      this.turnWaitingStartedAt ??= now;
      return;
    }

    if (this.turnWaitingStartedAt !== null) {
      this.turnWaitingStartedAt = null;
    }
    this.turnActiveStartedAt ??= now;
  }

  private getTurnActiveElapsedMs(now = Date.now()): number {
    let elapsed = this.turnAccumulatedActiveMs;
    if (
      this.pendingServerRequestIds.size === 0 &&
      this.turnActiveStartedAt !== null
    ) {
      elapsed += now - this.turnActiveStartedAt;
    }
    return elapsed;
  }
}
