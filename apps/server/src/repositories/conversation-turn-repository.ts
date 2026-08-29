import { randomUUID } from "node:crypto";
import type {
  ConversationTurn,
  ConversationTurnStatus,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

function rowToTurn(row: Record<string, unknown>): ConversationTurn {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    codexTurnId: String(row.codex_turn_id),
    status: String(row.status) as ConversationTurnStatus,
    model: row.model ? String(row.model) : undefined,
    effort: row.effort ? String(row.effort) : undefined,
    error: row.error_json ? JSON.parse(String(row.error_json)) : undefined,
    startedAtMs:
      row.started_at_ms === null ? undefined : Number(row.started_at_ms),
    completedAtMs:
      row.completed_at_ms === null ? undefined : Number(row.completed_at_ms),
    durationMs: row.duration_ms === null ? undefined : Number(row.duration_ms),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ConversationTurnRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    conversationId: string;
    codexTurnId: string;
    status?: ConversationTurnStatus;
    model?: string;
    effort?: string;
    startedAtMs?: number;
  }): ConversationTurn {
    const now = new Date().toISOString();
    const turn: ConversationTurn = {
      id: randomUUID(),
      conversationId: input.conversationId,
      codexTurnId: input.codexTurnId,
      status: input.status ?? "RUNNING",
      model: input.model,
      effort: input.effort,
      startedAtMs: input.startedAtMs,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO conversation_turns(
          id, conversation_id, codex_turn_id, status, model, effort,
          error_json, started_at_ms, completed_at_ms, duration_ms,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        turn.id,
        turn.conversationId,
        turn.codexTurnId,
        turn.status,
        turn.model ?? null,
        turn.effort ?? null,
        turn.startedAtMs ?? null,
        turn.createdAt,
        turn.updatedAt,
      );

    return turn;
  }

  get(id: string): ConversationTurn | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversation_turns WHERE id = ?")
      .get(id);
    return row
      ? rowToTurn(row as unknown as Record<string, unknown>)
      : undefined;
  }

  getByCodexTurnId(
    conversationId: string,
    codexTurnId: string,
  ): ConversationTurn | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM conversation_turns WHERE conversation_id = ? AND codex_turn_id = ?",
      )
      .get(conversationId, codexTurnId);
    return row
      ? rowToTurn(row as unknown as Record<string, unknown>)
      : undefined;
  }

  listByConversation(
    conversationId: string,
    options: { limit?: number; offset?: number } = {},
  ): ConversationTurn[] {
    const limit = options.limit ?? 200;
    const offset = options.offset ?? 0;
    return this.db
      .prepare(
        `SELECT * FROM conversation_turns
         WHERE conversation_id = ?
         ORDER BY COALESCE(started_at_ms, 0) ASC, created_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(conversationId, limit, offset)
      .map((row) => rowToTurn(row as unknown as Record<string, unknown>));
  }

  update(
    id: string,
    input: Partial<
      Pick<
        ConversationTurn,
        | "status"
        | "model"
        | "effort"
        | "error"
        | "completedAtMs"
        | "durationMs"
      >
    >,
  ): void {
    const existing = this.get(id);
    if (!existing) {
      return;
    }
    const next: ConversationTurn = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE conversation_turns SET
          status = ?,
          model = ?,
          effort = ?,
          error_json = ?,
          completed_at_ms = ?,
          duration_ms = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        next.status,
        next.model ?? null,
        next.effort ?? null,
        next.error === undefined ? null : JSON.stringify(next.error),
        next.completedAtMs ?? null,
        next.durationMs ?? null,
        next.updatedAt,
        id,
      );
  }
}
