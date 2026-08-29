import { randomUUID } from "node:crypto";
import type {
  ConversationItem,
  ConversationItemType,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

function rowToItem(row: Record<string, unknown>): ConversationItem {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    codexTurnId: row.codex_turn_id ? String(row.codex_turn_id) : null,
    codexItemId: row.codex_item_id ? String(row.codex_item_id) : null,
    parentItemId: row.parent_item_id ? String(row.parent_item_id) : null,
    itemType: String(row.item_type) as ConversationItemType,
    role: row.role ? String(row.role) : null,
    author: row.author ? String(row.author) : null,
    title: row.title ? String(row.title) : null,
    status: row.status ? String(row.status) : null,
    payload: JSON.parse(String(row.payload_json)),
    seq: Number(row.seq),
    createdAtMs:
      row.created_at_ms === null ? null : Number(row.created_at_ms),
    completedAtMs:
      row.completed_at_ms === null ? null : Number(row.completed_at_ms),
    createdAt: String(row.created_at),
  };
}

export class ConversationItemRepository {
  constructor(private readonly db: AppDatabase) {}

  nextSeq(conversationId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM conversation_items WHERE conversation_id = ?",
      )
      .get(conversationId) as { next_seq: number | bigint } | undefined;
    return Number(row?.next_seq ?? 1);
  }

  create(input: {
    conversationId: string;
    codexTurnId?: string | null;
    codexItemId?: string | null;
    parentItemId?: string | null;
    itemType: ConversationItemType;
    role?: string | null;
    author?: string | null;
    title?: string | null;
    status?: string | null;
    payload: unknown;
    createdAtMs?: number | null;
  }): ConversationItem {
    const now = new Date().toISOString();
    const item: ConversationItem = {
      id: randomUUID(),
      conversationId: input.conversationId,
      codexTurnId: input.codexTurnId ?? null,
      codexItemId: input.codexItemId ?? null,
      parentItemId: input.parentItemId ?? null,
      itemType: input.itemType,
      role: input.role ?? null,
      author: input.author ?? null,
      title: input.title ?? null,
      status: input.status ?? null,
      payload: input.payload,
      seq: this.nextSeq(input.conversationId),
      createdAtMs: input.createdAtMs ?? Date.now(),
      completedAtMs: null,
      createdAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO conversation_items(
          id, conversation_id, codex_turn_id, codex_item_id, parent_item_id,
          item_type, role, author, title, status, payload_json, seq,
          created_at_ms, completed_at_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        item.id,
        item.conversationId,
        item.codexTurnId,
        item.codexItemId,
        item.parentItemId,
        item.itemType,
        item.role,
        item.author,
        item.title,
        item.status,
        JSON.stringify(redactObject(item.payload)),
        item.seq,
        item.createdAtMs,
        item.createdAt,
      );

    return item;
  }

  get(id: string): ConversationItem | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversation_items WHERE id = ?")
      .get(id);
    return row
      ? rowToItem(row as unknown as Record<string, unknown>)
      : undefined;
  }

  getByCodexItemId(
    conversationId: string,
    codexItemId: string,
  ): ConversationItem | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM conversation_items WHERE conversation_id = ? AND codex_item_id = ? LIMIT 1",
      )
      .get(conversationId, codexItemId);
    return row
      ? rowToItem(row as unknown as Record<string, unknown>)
      : undefined;
  }

  listByConversation(
    conversationId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): ConversationItem[] {
    const afterSeq = options.afterSeq ?? 0;
    const limit = options.limit ?? 200;
    return this.db
      .prepare(
        `SELECT * FROM conversation_items
         WHERE conversation_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(conversationId, afterSeq, limit)
      .map((row) => rowToItem(row as unknown as Record<string, unknown>));
  }

  listByTurn(
    conversationId: string,
    codexTurnId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): ConversationItem[] {
    const afterSeq = options.afterSeq ?? 0;
    const limit = options.limit ?? 500;
    return this.db
      .prepare(
        `SELECT * FROM conversation_items
         WHERE conversation_id = ? AND codex_turn_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(conversationId, codexTurnId, afterSeq, limit)
      .map((row) => rowToItem(row as unknown as Record<string, unknown>));
  }

  update(
    id: string,
    input: Partial<
      Pick<
        ConversationItem,
        "status" | "payload" | "title" | "completedAtMs"
      >
    >,
  ): void {
    const existing = this.get(id);
    if (!existing) {
      return;
    }
    const next: ConversationItem = {
      ...existing,
      ...input,
    };

    this.db
      .prepare(
        `UPDATE conversation_items SET
          status = ?,
          title = ?,
          payload_json = ?,
          completed_at_ms = ?
        WHERE id = ?`,
      )
      .run(
        next.status,
        next.title,
        JSON.stringify(redactObject(next.payload)),
        next.completedAtMs,
        id,
      );
  }
}
