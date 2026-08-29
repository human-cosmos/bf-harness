import type {
  ConversationItem,
  ConversationEventKind,
  ConversationItemType,
} from "@bugfix-harness/shared";
import type { AppServerRuntime } from "./app-server-runtime.js";
import type { ConversationEventRepository } from "../repositories/conversation-event-repository.js";
import type { ConversationItemRepository } from "../repositories/conversation-item-repository.js";

interface Notification {
  method: string;
  params: unknown;
}

function eventKindForMethod(method: string): ConversationEventKind {
  if (method === "turn/started") return "turn.started";
  if (method === "turn/completed") return "turn.completed";
  if (method === "item/started") return "raw";
  if (method === "item/completed") return "raw";
  if (method === "item/agentMessage/delta") return "agent.message.delta";
  if (method === "item/reasoning/summaryTextDelta")
    return "reasoning.summary.delta";
  if (method === "item/reasoning/textDelta") return "reasoning.text.delta";
  if (method === "item/plan/delta") return "plan.delta";
  if (method === "item/commandExecution/outputDelta")
    return "command.output.delta";
  if (method === "process/outputDelta") return "command.output.delta";
  if (method === "process/exited") return "command.completed";
  if (method === "item/fileChange/patchUpdated")
    return "fileChange.patchUpdated";
  if (method === "item/mcpToolCall/progress") return "mcpTool.progress";
  if (method === "thread/tokenUsage/updated") return "tokenUsage.updated";
  if (method === "thread/compacted") return "compaction.started";
  if (method === "warning") return "warning";
  if (method === "error") return "error";
  if (method === "serverRequest/resolved") return "raw";
  return "raw";
}

function itemTypeForMethod(method: string): ConversationItemType | null {
  if (method === "item/agentMessage/delta") return "agentMessage";
  if (method === "item/reasoning/summaryTextDelta") return "reasoning";
  if (method === "item/reasoning/textDelta") return "reasoning";
  if (method === "item/plan/delta") return "plan";
  if (method === "item/commandExecution/outputDelta")
    return "commandExecution";
  if (method === "item/fileChange/patchUpdated") return "fileChange";
  if (method === "item/mcpToolCall/progress") return "mcpToolCall";
  if (method === "thread/tokenUsage/updated") return "tokenUsage";
  return null;
}

export class ConversationEventIngestor {
  private readonly itemByCodexId = new Map<string, string>();
  private readonly localUserMessages: ConversationItem[];

  constructor(
    private readonly events: ConversationEventRepository,
    private readonly items: ConversationItemRepository,
    private readonly conversationId: string,
  ) {
    this.localUserMessages = this.items
      .listByConversation(conversationId, { limit: 1000 })
      .filter(
        (item) => item.itemType === "userMessage" && !item.codexItemId,
      );
  }

  attach(runtime: AppServerRuntime): () => void {
    const listener = (notification: Notification) => {
      this.ingest(runtime, notification);
    };
    runtime.on("notification", listener);
    return () => runtime.off("notification", listener);
  }

  private ingest(runtime: AppServerRuntime, notification: Notification): void {
    const data = (notification.params ?? {}) as Record<string, unknown>;
    const threadId = data.threadId
      ? String(data.threadId)
      : runtime.currentThreadId;
    const turnId = data.turnId ? String(data.turnId) : runtime.currentTurnId;
    const itemId = data.itemId
      ? String(data.itemId)
      : data.item && typeof data.item === "object"
        ? String((data.item as Record<string, unknown>).id ?? "") || null
        : null;
    const method = notification.method;

    this.events.append({
      conversationId: this.conversationId,
      codexThreadId: threadId,
      codexTurnId: turnId,
      codexItemId: itemId,
      kind: eventKindForMethod(method),
      method,
      payload: data,
      emittedAtMs: Date.now(),
    });

    this.ingestItem(method, data, threadId, turnId, itemId);
  }

  private ingestItem(
    method: string,
    data: Record<string, unknown>,
    threadId: string | null,
    turnId: string | null,
    itemId: string | null,
  ): void {
    if (method === "item/started") {
      const codexItem = data.item as Record<string, unknown> | undefined;
      const type = this.normalizeItemType(codexItem);
      if (!type || !itemId) return;
      if (
        type === "userMessage" &&
        this.isDuplicateLocalUserMessage(codexItem)
      ) {
        return;
      }
      const created = this.items.create({
        conversationId: this.conversationId,
        codexTurnId: turnId,
        codexItemId: itemId,
        itemType: type,
        role: this.roleForItem(codexItem),
        author: codexItem?.author ? String(codexItem.author) : null,
        title: codexItem?.title ? String(codexItem.title) : null,
        status: "inProgress",
        payload: codexItem ?? data,
      });
      this.itemByCodexId.set(itemId, created.id);
      return;
    }

    if (method === "item/completed") {
      const codexItem = data.item as Record<string, unknown> | undefined;
      const type = this.normalizeItemType(codexItem);
      const storedId = itemId ? this.itemByCodexId.get(itemId) : null;
      if (storedId) {
        this.items.update(storedId, {
          status: "completed",
          payload: codexItem ?? data,
          completedAtMs: Date.now(),
        });
      } else if (
        type &&
        itemId &&
        !(
          type === "userMessage" &&
          this.isDuplicateLocalUserMessage(codexItem)
        )
      ) {
        const created = this.items.create({
          conversationId: this.conversationId,
          codexTurnId: turnId,
          codexItemId: itemId,
          itemType: type,
          role: this.roleForItem(codexItem),
          author: codexItem?.author ? String(codexItem.author) : null,
          title: codexItem?.title ? String(codexItem.title) : null,
          status: "completed",
          payload: codexItem ?? data,
          createdAtMs: Date.now(),
        });
        this.itemByCodexId.set(itemId, created.id);
      }
      return;
    }

    const type = itemTypeForMethod(method);
    if (!type) return;

    const storedId = itemId ? this.itemByCodexId.get(itemId) : null;
    if (storedId) {
      this.items.update(storedId, { payload: data, status: "inProgress" });
      return;
    }

    const created = this.items.create({
      conversationId: this.conversationId,
      codexTurnId: turnId,
      codexItemId: itemId,
      itemType: type,
      role: type === "agentMessage" ? "assistant" : null,
      status: "inProgress",
      payload: data,
    });
    if (itemId) {
      this.itemByCodexId.set(itemId, created.id);
    }
  }

  private normalizeItemType(
    item: Record<string, unknown> | undefined,
  ): ConversationItemType | null {
    if (!item?.type) return null;
    const raw = String(item.type);
    const aliases: Record<string, ConversationItemType> = {
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
      tokenUsage: "tokenUsage",
    };
    return aliases[raw] ?? null;
  }

  private isDuplicateLocalUserMessage(
    codexItem: Record<string, unknown> | undefined,
  ): boolean {
    const codexIdentity = this.userMessageIdentity(codexItem);
    if (!codexIdentity) return false;
    return this.localUserMessages.some(
      (item) =>
        this.userMessageIdentity(
          item.payload as Record<string, unknown> | undefined,
        ) === codexIdentity,
    );
  }

  private userMessageIdentity(
    payload: Record<string, unknown> | undefined,
  ): string {
    const text = this.textFromPayload(payload).trim();
    const mentions = this.mentionsFromPayload(payload)
      .map((mention) => `${mention.name}\u0000${mention.path}`)
      .sort();
    return JSON.stringify({ text, mentions });
  }

  private textFromPayload(
    payload: Record<string, unknown> | undefined,
  ): string {
    if (typeof payload?.text === "string") return payload.text;
    return this.contentParts(payload)
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  private mentionsFromPayload(
    payload: Record<string, unknown> | undefined,
  ): Array<{ name: string; path: string }> {
    if (Array.isArray(payload?.mentions)) {
      return payload.mentions.flatMap((mention) => {
        if (!mention || typeof mention !== "object") return [];
        const record = mention as Record<string, unknown>;
        return typeof record.name === "string" &&
          typeof record.path === "string"
          ? [{ name: record.name, path: record.path }]
          : [];
      });
    }

    return this.contentParts(payload).flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const record = part as Record<string, unknown>;
      const type = record.type;
      if (
        type === "mention" &&
        typeof record.name === "string" &&
        typeof record.path === "string"
      ) {
        return [{ name: record.name, path: record.path }];
      }
      return [];
    });
  }

  private contentParts(
    payload: Record<string, unknown> | undefined,
  ): unknown[] {
    return Array.isArray(payload?.content) ? payload.content : [];
  }

  private roleForItem(item: Record<string, unknown> | undefined): string | null {
    if (item?.role) return String(item.role);
    if (item?.type === "agentMessage") return "assistant";
    if (item?.type === "userMessage") return "user";
    return null;
  }
}
