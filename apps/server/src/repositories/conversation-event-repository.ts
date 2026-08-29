import type {
  ConversationEvent,
  ConversationEventKind,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

function rowToEvent(row: Record<string, unknown>): ConversationEvent {
  return {
    id: Number(row.id),
    conversationId: String(row.conversation_id),
    codexThreadId: row.codex_thread_id ? String(row.codex_thread_id) : null,
    codexTurnId: row.codex_turn_id ? String(row.codex_turn_id) : null,
    codexItemId: row.codex_item_id ? String(row.codex_item_id) : null,
    kind: String(row.kind) as ConversationEventKind,
    method: String(row.method),
    payload: JSON.parse(String(row.payload_json)),
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : null,
    seq: Number(row.seq),
    emittedAtMs:
      row.emitted_at_ms === null ? null : Number(row.emitted_at_ms),
    createdAt: String(row.created_at),
  };
}

export class ConversationEventRepository {
  constructor(private readonly db: AppDatabase) {}

  nextSeq(conversationId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM conversation_events WHERE conversation_id = ?",
      )
      .get(conversationId) as { next_seq: number | bigint } | undefined;
    return Number(row?.next_seq ?? 1);
  }

  append(input: {
    conversationId: string;
    codexThreadId?: string | null;
    codexTurnId?: string | null;
    codexItemId?: string | null;
    kind: ConversationEventKind;
    method: string;
    payload: unknown;
    dedupeKey?: string | null;
    emittedAtMs?: number | null;
  }): ConversationEvent {
    const event: ConversationEvent = {
      conversationId: input.conversationId,
      codexThreadId: input.codexThreadId ?? null,
      codexTurnId: input.codexTurnId ?? null,
      codexItemId: input.codexItemId ?? null,
      kind: input.kind,
      method: input.method,
      payload: input.payload,
      dedupeKey: input.dedupeKey ?? null,
      seq: this.nextSeq(input.conversationId),
      emittedAtMs: input.emittedAtMs ?? Date.now(),
      createdAt: new Date().toISOString(),
    };

    const result = this.db
      .prepare(
        `INSERT INTO conversation_events(
          conversation_id, codex_thread_id, codex_turn_id, codex_item_id,
          method, payload_json, dedupe_key, seq, emitted_at_ms, kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.conversationId,
        event.codexThreadId,
        event.codexTurnId,
        event.codexItemId,
        event.method,
        JSON.stringify(redactObject(event.payload)),
        event.dedupeKey,
        event.seq,
        event.emittedAtMs,
        event.kind,
        event.createdAt,
      );

    return { ...event, id: Number(result.lastInsertRowid) };
  }

  listByConversation(
    conversationId: string,
    options: { afterSeq?: number; limit?: number } = {},
  ): ConversationEvent[] {
    const afterSeq = options.afterSeq ?? 0;
    const limit = options.limit ?? 1000;
    return this.db
      .prepare(
        `SELECT * FROM conversation_events
         WHERE conversation_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(conversationId, afterSeq, limit)
      .map((row) => rowToEvent(row as unknown as Record<string, unknown>));
  }

  countByConversation(conversationId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM conversation_events WHERE conversation_id = ?",
      )
      .get(conversationId) as { count: number | bigint };
    return Number(row.count);
  }
}
