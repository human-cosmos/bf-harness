import { randomUUID } from "node:crypto";
import {
  createConversationInputSchema,
  fallbackConversationTitle,
  sendConversationMessageSchema,
  updateConversationInputSchema,
  type Conversation,
  type ConversationEventKind,
  type ConversationItemType,
  type ConversationPolicy,
  type ConversationSettings,
  type ConversationTurnStatus,
  type CreateConversationInput,
  type SendConversationMessageInput,
  type SystemSettings,
  type UpdateConversationInput,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { ConversationRepository } from "../repositories/conversation-repository.js";
import { ConversationTurnRepository } from "../repositories/conversation-turn-repository.js";
import { ConversationItemRepository } from "../repositories/conversation-item-repository.js";
import { ConversationEventRepository } from "../repositories/conversation-event-repository.js";
import { ConversationApprovalRepository } from "../repositories/conversation-approval-repository.js";
import { ConversationClarificationRepository } from "../repositories/conversation-clarification-repository.js";
import type { AppServerRuntime } from "./app-server-runtime.js";
import { ConversationRuntimeManager } from "./conversation-runtime-manager.js";
import { ConversationEventIngestor } from "./conversation-event-ingestor.js";
import {
  ConversationInteractionCoordinator,
  type ConversationApprovalDecision,
} from "./conversation-interaction-coordinator.js";
import { DynamicToolRegistry } from "./dynamic-tool-registry.js";
import { EventBus } from "./event-bus.js";

export interface ConversationServiceOptions {
  db: AppDatabase;
  projects: ProjectRepository;
  eventBus?: EventBus;
  codexBin?: string;
  getCodexBin?: () => string;
  timeoutMs?: number;
  approvalTimeoutMs?: number | null;
  runtimeManager?: ConversationRuntimeManager;
  defaultPolicy?: ConversationPolicy;
  defaultSettings?: ConversationSettings;
  getSystemSettings?: () => SystemSettings;
}

function buildProtocolInput(message: SendConversationMessageInput): unknown[] {
  const parts: unknown[] = [
    {
      type: "text",
      text: message.text,
      text_elements: [],
    },
  ];

  for (const mention of message.mentions) {
    parts.push({
      type: "mention",
      name: mention.name,
      path: mention.path,
    });
  }

  return parts;
}

export class ConversationService {
  readonly conversations: ConversationRepository;
  readonly turns: ConversationTurnRepository;
  readonly items: ConversationItemRepository;
  readonly events: ConversationEventRepository;
  readonly approvals: ConversationApprovalRepository;
  readonly clarifications: ConversationClarificationRepository;
  readonly eventsBus: EventBus;

  private readonly runtimeManager: ConversationRuntimeManager;
  private readonly activeCoordinators = new Map<
    string,
    ConversationInteractionCoordinator
  >();
  private readonly activeTurnIds = new Set<string>();
  private readonly timeoutMs: number;
  private readonly approvalTimeoutMs: number | null;
  private readonly defaultPolicy: ConversationPolicy | undefined;
  private readonly defaultSettings: ConversationSettings | undefined;
  private readonly getSystemSettings: (() => SystemSettings) | undefined;

  constructor(private readonly options: ConversationServiceOptions) {
    this.conversations = new ConversationRepository(options.db);
    this.turns = new ConversationTurnRepository(options.db);
    this.items = new ConversationItemRepository(options.db);
    this.events = new ConversationEventRepository(options.db);
    this.approvals = new ConversationApprovalRepository(options.db);
    this.clarifications = new ConversationClarificationRepository(options.db);
    this.eventsBus = options.eventBus ?? new EventBus();
    this.defaultPolicy = options.defaultPolicy;
    this.defaultSettings = options.defaultSettings;
    this.getSystemSettings = options.getSystemSettings;
    this.timeoutMs =
      options.timeoutMs ??
      Number(process.env.BUGFIX_HARNESS_CONVERSATION_TIMEOUT_MS ?? 600_000);
    this.approvalTimeoutMs =
      options.approvalTimeoutMs ??
      (process.env.BUGFIX_HARNESS_APPROVAL_TTL_MS
        ? Number(process.env.BUGFIX_HARNESS_APPROVAL_TTL_MS)
        : null);

    this.runtimeManager =
      options.runtimeManager ??
      new ConversationRuntimeManager({
        codexBin: options.codexBin,
        getCodexBin: options.getCodexBin,
        onThreadStarted: (conversationId, threadId) => {
          this.conversations.updateThreadId(conversationId, threadId);
        },
      });
  }

  closeAllRuntimes(): void {
    this.runtimeManager.closeAll();
  }

  async createConversation(input: unknown): Promise<Conversation> {
    const parsed = createConversationInputSchema.parse(input);
    const project = this.options.projects.get(parsed.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const title = parsed.title.trim() || "";
    const systemSettings = this.getSystemSettings?.();
    const conversation = this.conversations.create({
      projectId: parsed.projectId,
      title,
      policy: {
        ...(systemSettings?.security.conversationDefaults ??
          this.defaultPolicy ??
          parsed.policy),
        ...parsed.policy,
      },
      settings: {
        ...{
          model:
            systemSettings?.models.conversationModel ??
            this.defaultSettings?.model,
          reasoningEffort:
            systemSettings?.models.conversationReasoningEffort ??
            this.defaultSettings?.reasoningEffort,
          baseInstructions: this.defaultSettings?.baseInstructions,
          developerInstructions: this.defaultSettings?.developerInstructions,
        },
        ...parsed.settings,
      },
    });
    this.publishEvent(conversation.id, "raw", "conversation.created", {
      conversation,
    });
    return conversation;
  }

  listConversations(projectId: string): Conversation[] {
    return this.conversations.list(projectId);
  }

  listConversationsPage(
    projectId: string,
    page: number,
    pageSize: number,
  ): { items: Conversation[]; total: number; page: number; pageSize: number } {
    const total = this.conversations.count(projectId);
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const offset = (safePage - 1) * safePageSize;
    const items = this.conversations.listPage(
      projectId,
      safePageSize,
      offset,
    );
    return { items, total, page: safePage, pageSize: safePageSize };
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  updateConversation(id: string, input: unknown): Conversation {
    const parsed = updateConversationInputSchema.parse(input);
    const existing = this.conversations.get(id);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    const updated = this.conversations.update(id, parsed);
    if (!updated) {
      throw new Error("Conversation not found");
    }
    this.publishEvent(id, "raw", "conversation.updated", { conversation: updated });
    return updated;
  }

  async renameConversation(id: string, title: string): Promise<Conversation> {
    const normalized = title.trim();
    if (!normalized) {
      throw new Error("title is required");
    }
    const existing = this.conversations.get(id);
    if (!existing) {
      throw new Error("Conversation not found");
    }

    const updated = this.conversations.update(id, {
      title: normalized.slice(0, 120),
    });
    if (!updated) {
      throw new Error("Conversation not found");
    }

    const runtime = this.runtimeManager.get(id);
    const threadId = existing.codexThreadId ?? runtime?.currentThreadId;
    if (runtime && threadId) {
      this.syncThreadNameBestEffort(runtime, threadId, updated.title);
    }

    this.publishEvent(id, "raw", "conversation.updated", {
      conversation: updated,
    });
    return updated;
  }

  async deleteConversation(id: string): Promise<{ deleted: boolean }> {
    if (!this.conversations.get(id)) {
      throw new Error("Conversation not found");
    }
    await this.runtimeManager.interrupt(id);
    this.activeCoordinators.get(id)?.cancelPending();
    this.activeCoordinators.delete(id);
    this.activeTurnIds.delete(id);
    const deleted = this.conversations.delete(id);
    this.eventsBus.publish({
      type: "conversation.deleted",
      payload: { conversationId: id },
    });
    return { deleted };
  }

  async sendMessage(
    conversationId: string,
    rawInput: unknown,
  ): Promise<{ turnId: string }> {
    const input = sendConversationMessageSchema.parse(rawInput);
    const conversation = this.requireConversation(conversationId);
    const project = this.options.projects.get(conversation.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    if (this.activeTurnIds.has(conversationId)) {
      throw new Error("A turn is already running for this conversation");
    }

    this.persistUserMessage(conversationId, input);

    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      conversation,
      project.repoPath,
    );
    if (!conversation.codexThreadId && runtime.currentThreadId) {
      this.conversations.updateThreadId(conversationId, runtime.currentThreadId);
    }
    this.conversations.updateStatus(conversationId, "RUNNING");
    this.bindInteraction(conversationId, runtime, conversation, project.repoPath);
    this.activeTurnIds.add(conversationId);

    const detach = new ConversationEventIngestor(
      this.events,
      this.items,
      conversationId,
    ).attach(runtime);

    try {
      const result = (await runtime.startTurn({
        threadId: runtime.currentThreadId!,
        input: buildProtocolInput(input),
        model: conversation.settings.model ?? null,
        effort: conversation.settings.reasoningEffort ?? null,
        approvalPolicy: conversation.policy.approvalPolicy,
        approvalsReviewer: conversation.policy.approvalsReviewer,
        sandboxPolicy: this.sandboxPolicyFor(conversation, project.repoPath),
      })) as { turn?: { id?: string } };

      const codexTurnId = result?.turn?.id ?? runtime.currentTurnId;
      if (!codexTurnId) {
        throw new Error("App Server did not return a turn id");
      }

      this.turns.create({
        conversationId,
        codexTurnId,
        model: conversation.settings.model,
        effort: conversation.settings.reasoningEffort,
        startedAtMs: Date.now(),
      });

      const completion = await runtime.waitForTurnCompletion({
        idleTimeoutMs:
          this.getSystemSettings?.().agent.conversationIdleTimeoutMs ??
          this.timeoutMs,
      });
      const turn = this.turns.getByCodexTurnId(conversationId, codexTurnId);
      if (turn) {
        this.turns.update(turn.id, {
          status: "COMPLETED",
          completedAtMs: Date.now(),
          durationMs: Number(
            (completion as { turn?: { durationMs?: number | null } })?.turn
              ?.durationMs ?? null,
          ),
        });
      }

      this.conversations.updateStatus(conversationId, "IDLE");
      this.activeTurnIds.delete(conversationId);
      const threadId =
        conversation.codexThreadId ?? runtime.currentThreadId;
      if (threadId) {
        void this.generateConversationTitleIfNeeded(
          conversationId,
          threadId,
          runtime,
          input.text || input.mentions[0]?.name || "",
        ).catch(() => {
          // Title generation is best-effort and must not affect the message
          // response once the turn has completed.
        });
      }
      return { turnId: codexTurnId };
    } catch (error) {
      const turn = runtime.currentTurnId
        ? this.turns.getByCodexTurnId(conversationId, runtime.currentTurnId)
        : undefined;
      if (turn) {
        this.turns.update(turn.id, {
          status: "FAILED",
          error: (error as Error).message,
          completedAtMs: Date.now(),
        });
      }
      this.conversations.updateStatus(conversationId, "FAILED");
      this.activeTurnIds.delete(conversationId);
      throw error;
    } finally {
      detach();
    }
  }

  async steerConversation(
    conversationId: string,
    rawInput: unknown,
  ): Promise<unknown> {
    const input = sendConversationMessageSchema.parse(rawInput);
    const conversation = this.requireConversation(conversationId);
    const project = this.options.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      conversation,
      project.repoPath,
    );
    if (!runtime.currentThreadId || !runtime.currentTurnId) {
      throw new Error("No active turn to steer");
    }
    return runtime.steerTurn(
      runtime.currentThreadId,
      runtime.currentTurnId,
      buildProtocolInput(input),
    );
  }

  async interruptConversation(conversationId: string): Promise<void> {
    this.activeCoordinators.get(conversationId)?.cancelPending();
    this.activeTurnIds.delete(conversationId);
    await this.runtimeManager.interrupt(conversationId);
    if (this.conversations.get(conversationId)) {
      this.conversations.updateStatus(conversationId, "IDLE");
    }
  }

  async forkConversation(
    conversationId: string,
    options: { lastTurnId?: string | null } = {},
  ): Promise<Conversation> {
    const source = this.requireConversation(conversationId);
    const project = this.options.projects.get(source.projectId);
    if (!project) throw new Error("Project not found");
    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      source,
      project.repoPath,
    );
    const result = (await runtime.forkThread(source.codexThreadId ?? runtime.currentThreadId!, {
      lastTurnId: options.lastTurnId,
      excludeTurns: true,
    })) as { thread?: { id?: string } };
    const threadId = result?.thread?.id;
    if (!threadId) throw new Error("Fork did not return a thread id");

    const forked = this.conversations.create({
      projectId: source.projectId,
      title: `${source.title} (fork)`,
      policy: source.policy,
      settings: source.settings,
    });
    this.conversations.updateThreadId(forked.id, threadId);
    return forked;
  }

  async compactConversation(conversationId: string): Promise<unknown> {
    const conversation = this.requireConversation(conversationId);
    const project = this.options.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      conversation,
      project.repoPath,
    );
    return runtime.compactThread(conversation.codexThreadId ?? runtime.currentThreadId!);
  }

  async archiveConversation(conversationId: string): Promise<Conversation> {
    const conversation = this.requireConversation(conversationId);
    const project = this.options.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      conversation,
      project.repoPath,
    );
    await runtime.archiveThread(conversation.codexThreadId ?? runtime.currentThreadId!);
    this.conversations.updateStatus(conversationId, "ARCHIVED");
    return this.conversations.get(conversationId)!;
  }

  listModels(conversationId: string): Promise<unknown> {
    return this.withRuntime(conversationId, (runtime) => runtime.listModels());
  }

  listTurns(conversationId: string, options: { limit?: number; offset?: number } = {}) {
    return this.turns.listByConversation(conversationId, options);
  }

  listItems(
    conversationId: string,
    options: { turnId?: string; afterSeq?: number; limit?: number } = {},
  ) {
    if (options.turnId) {
      return this.items.listByTurn(conversationId, options.turnId, options);
    }
    return this.items.listByConversation(conversationId, options);
  }

  listEvents(
    conversationId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ) {
    return this.events.listByConversation(conversationId, options);
  }

  async syncConversationHistory(
    conversationId: string,
  ): Promise<{ turns: number; items: number }> {
    const conversation = this.requireConversation(conversationId);
    const project = this.options.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      conversation,
      project.repoPath,
    );
    const threadId = conversation.codexThreadId ?? runtime.currentThreadId;
    if (!threadId) {
      return { turns: 0, items: 0 };
    }

    const turns = await this.listAllTurns(runtime, threadId);
    let turnCount = 0;
    let itemCount = 0;

    for (const rawTurn of turns) {
      const codexTurnId = String(rawTurn.id ?? "");
      if (!codexTurnId) continue;

      let storedTurn = this.turns.getByCodexTurnId(
        conversationId,
        codexTurnId,
      );
      if (!storedTurn) {
        storedTurn = this.turns.create({
          conversationId,
          codexTurnId,
          status: this.normalizeTurnStatus(rawTurn.status),
          model: rawTurn.model ? String(rawTurn.model) : undefined,
          effort: rawTurn.effort ? String(rawTurn.effort) : undefined,
          startedAtMs: rawTurn.startedAt
            ? Number(rawTurn.startedAt) * 1000
            : undefined,
        });
        turnCount += 1;
      } else {
        this.turns.update(storedTurn.id, {
          status: this.normalizeTurnStatus(rawTurn.status),
          completedAtMs: rawTurn.completedAt
            ? Number(rawTurn.completedAt) * 1000
            : undefined,
          durationMs: rawTurn.durationMs
            ? Number(rawTurn.durationMs)
            : undefined,
        });
      }

      const items = await this.listAllItems(runtime, threadId, codexTurnId);

      for (const rawItem of items) {
        const codexItemId = String(rawItem.id ?? "");
        const itemType = this.normalizeItemType(rawItem);
        if (!codexItemId || !itemType) continue;
        if (this.items.getByCodexItemId(conversationId, codexItemId)) {
          continue;
        }
        this.items.create({
          conversationId,
          codexTurnId,
          codexItemId,
          itemType,
          role: this.roleForItem(rawItem),
          author: rawItem.author ? String(rawItem.author) : null,
          title: rawItem.title ? String(rawItem.title) : null,
          status: rawItem.status ? String(rawItem.status) : null,
          payload: rawItem,
        });
        itemCount += 1;
      }
    }

    return { turns: turnCount, items: itemCount };
  }

  getPendingApprovals(conversationId: string) {
    return this.approvals.listByConversation(conversationId, {
      pendingOnly: true,
    });
  }

  decideApproval(
    conversationId: string,
    approvalId: string,
    decision: ConversationApprovalDecision,
  ) {
    this.activeCoordinators.get(conversationId)?.decideApproval(
      approvalId,
      decision,
    );
  }

  getPendingClarification(conversationId: string) {
    return this.clarifications.getPendingByConversation(conversationId);
  }

  answerClarification(
    conversationId: string,
    clarificationId: string,
    answers: Record<string, { answers: string[] }>,
  ) {
    this.activeCoordinators.get(conversationId)?.answerClarification(
      clarificationId,
      answers,
    );
  }

  private async withRuntime<T>(
    conversationId: string,
    action: (runtime: AppServerRuntime) => Promise<T> | T,
  ): Promise<T> {
    const conversation = this.requireConversation(conversationId);
    const project = this.options.projects.get(conversation.projectId);
    if (!project) throw new Error("Project not found");
    const runtime = await this.runtimeManager.getOrCreate(
      conversationId,
      conversation,
      project.repoPath,
    );
    return action(runtime);
  }

  private bindInteraction(
    conversationId: string,
    runtime: AppServerRuntime,
    conversation: Conversation,
    projectRoot: string,
  ): void {
    const coordinator = new ConversationInteractionCoordinator(
      conversationId,
      this.approvals,
      this.clarifications,
      this.eventsBus,
      conversation.policy,
      new DynamicToolRegistry(projectRoot),
      this.getSystemSettings?.().agent.approvalTtlMs ?? this.approvalTimeoutMs,
    );
    this.activeCoordinators.set(conversationId, coordinator);
    runtime.onServerRequest = (message) =>
      coordinator.handleServerRequest(message);
  }

  private sandboxPolicyFor(
    conversation: Conversation,
    projectRoot: string,
  ): {
    type: "readOnly" | "workspaceWrite" | "dangerFullAccess";
    networkAccess?: boolean;
    writableRoots?: string[];
    excludeTmpdirEnvVar?: boolean;
    excludeSlashTmp?: boolean;
  } {
    const mode = conversation.policy.sandboxMode;
    if (mode === "read-only") {
      return {
        type: "readOnly",
        networkAccess: conversation.policy.networkAccess,
      };
    }
    if (mode === "danger-full-access") {
      return { type: "dangerFullAccess" };
    }
    return {
      type: "workspaceWrite",
      writableRoots: [projectRoot],
      networkAccess: conversation.policy.networkAccess,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }

  private persistUserMessage(
    conversationId: string,
    input: SendConversationMessageInput,
  ): void {
    this.items.create({
      conversationId,
      itemType: "userMessage",
      role: "user",
      status: "completed",
      payload: {
        text: input.text,
        mentions: input.mentions,
        quickCommand: input.quickCommand,
      },
    });
    this.publishEvent(conversationId, "user.message", "user.message", input);
  }

  private async generateConversationTitleIfNeeded(
    conversationId: string,
    threadId: string,
    runtime: AppServerRuntime,
    fallbackText: string,
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (
      !conversation ||
      (conversation.title && conversation.title !== "未命名对话")
    ) {
      return;
    }

    let generatedTitle = "";
    try {
      if (typeof runtime.getConversationSummary === "function") {
        const result = (await runtime.getConversationSummary(threadId)) as {
          summary?: { preview?: string; title?: string };
        };
        const preview =
          result?.summary?.title ??
          result?.summary?.preview ??
          "";
        generatedTitle = this.normalizeConversationTitle(preview);
      }
    } catch {
      // Fall back to a deterministic title below.
    }

    if (!generatedTitle) {
      generatedTitle = fallbackConversationTitle(fallbackText);
    }

    if (generatedTitle && generatedTitle !== "未命名对话") {
      this.conversations.update(conversationId, { title: generatedTitle });
      this.syncThreadNameBestEffort(runtime, threadId, generatedTitle);
    }
  }

  private syncThreadNameBestEffort(
    runtime: AppServerRuntime,
    threadId: string,
    title: string,
  ): void {
    void runtime.setThreadName(threadId, title).catch(() => {
      // The local conversation title is authoritative even if the Codex
      // thread name cannot be updated.
    });
  }

  private normalizeConversationTitle(value: string): string {
    const firstLine = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const normalized = (firstLine ?? "")
      .replace(/\s+/g, " ")
      .replace(/^(标题[:：\s]+|title[:：\s]+)/i, "")
      .trim();
    return normalized.slice(0, 120);
  }

  private publishEvent(
    conversationId: string,
    kind: ConversationEventKind,
    method: string,
    payload: unknown,
  ): void {
    const event = this.events.append({
      conversationId,
      kind,
      method,
      payload,
      emittedAtMs: Date.now(),
    });
    this.eventsBus.publish({
      type: `conversation.${method}`,
      payload: { conversationId, event },
    });
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.conversations.get(id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    return conversation;
  }

  private async listAllTurns(
    runtime: AppServerRuntime,
    threadId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const turns: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;

    for (let page = 0; page < 100; page += 1) {
      const result = (await runtime.listTurns(threadId, {
        cursor,
        limit: 200,
      })) as {
        data?: Array<Record<string, unknown>>;
        nextCursor?: string | null;
      };
      if (Array.isArray(result?.data)) {
        turns.push(...result.data);
      }
      if (!result?.nextCursor) {
        break;
      }
      cursor = result.nextCursor;
    }

    return turns;
  }

  private async listAllItems(
    runtime: AppServerRuntime,
    threadId: string,
    turnId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;

    for (let page = 0; page < 100; page += 1) {
      const result = (await runtime.listItems(threadId, {
        turnId,
        cursor,
        limit: 1000,
      })) as {
        data?: Array<{
          turnId?: string;
          item?: Record<string, unknown>;
        }>;
        nextCursor?: string | null;
      };
      if (Array.isArray(result?.data)) {
        for (const entry of result.data) {
          if (entry?.item && typeof entry.item === "object") {
            items.push(entry.item);
          }
        }
      }
      if (!result?.nextCursor) {
        break;
      }
      cursor = result.nextCursor;
    }

    return items;
  }

  private normalizeTurnStatus(
    value: unknown,
  ): ConversationTurnStatus {
    const raw = String(value ?? "").toLowerCase();
    if (raw === "completed") return "COMPLETED";
    if (raw === "failed") return "FAILED";
    if (raw === "interrupted") return "INTERRUPTED";
    if (raw === "cancelled" || raw === "canceled") return "CANCELLED";
    return "RUNNING";
  }

  private normalizeItemType(
    item: Record<string, unknown>,
  ): ConversationItemType | null {
    const raw = String(item.type ?? "");
    const map: Record<string, ConversationItemType> = {
      agentMessage: "agentMessage",
      userMessage: "userMessage",
      reasoning: "reasoning",
      plan: "plan",
      commandExecution: "commandExecution",
      fileChange: "fileChange",
      mcpToolCall: "mcpToolCall",
      dynamicToolCall: "dynamicToolCall",
      webSearch: "webSearch",
      imageGeneration: "imageGeneration",
      contextCompaction: "contextCompaction",
    };
    return map[raw] ?? null;
  }

  private roleForItem(item: Record<string, unknown>): string | null {
    if (item.role) return String(item.role);
    if (item.type === "agentMessage") return "assistant";
    if (item.type === "userMessage") return "user";
    return null;
  }
}
