import { randomUUID } from "node:crypto";
import type { ConversationClarification } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

function rowToClarification(
  row: Record<string, unknown>,
): ConversationClarification {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    codexRequestId:
      row.codex_request_id === null ? null : Number(row.codex_request_id),
    codexTurnId: row.codex_turn_id ? String(row.codex_turn_id) : null,
    codexItemId: row.codex_item_id ? String(row.codex_item_id) : null,
    questions: JSON.parse(String(row.questions_json)),
    answers: row.answers_json ? JSON.parse(String(row.answers_json)) : null,
    status: String(row.status) as ConversationClarification["status"],
    createdAt: String(row.created_at),
    answeredAt: row.answered_at ? String(row.answered_at) : null,
  };
}

export class ConversationClarificationRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    conversationId: string;
    codexRequestId?: number | null;
    codexTurnId?: string | null;
    codexItemId?: string | null;
    questions: unknown;
  }): ConversationClarification {
    const clarification: ConversationClarification = {
      id: randomUUID(),
      conversationId: input.conversationId,
      codexRequestId: input.codexRequestId ?? null,
      codexTurnId: input.codexTurnId ?? null,
      codexItemId: input.codexItemId ?? null,
      questions: input.questions,
      answers: null,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      answeredAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO conversation_clarifications(
          id, conversation_id, codex_request_id, codex_turn_id, codex_item_id,
          questions_json, answers_json, status, created_at, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        clarification.id,
        clarification.conversationId,
        clarification.codexRequestId,
        clarification.codexTurnId,
        clarification.codexItemId,
        JSON.stringify(redactObject(clarification.questions)),
        clarification.status,
        clarification.createdAt,
      );

    return clarification;
  }

  get(id: string): ConversationClarification | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversation_clarifications WHERE id = ?")
      .get(id);
    return row
      ? rowToClarification(row as unknown as Record<string, unknown>)
      : undefined;
  }

  answer(id: string, answers: unknown): void {
    this.db
      .prepare(
        `UPDATE conversation_clarifications
         SET answers_json = ?, status = 'ANSWERED', answered_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(redactObject(answers)), new Date().toISOString(), id);
  }

  cancel(id: string): void {
    this.db
      .prepare(
        "UPDATE conversation_clarifications SET status = 'CANCELLED' WHERE id = ?",
      )
      .run(id);
  }

  getPendingByConversation(
    conversationId: string,
  ): ConversationClarification | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM conversation_clarifications
         WHERE conversation_id = ? AND status = 'PENDING'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(conversationId);
    return row
      ? rowToClarification(row as unknown as Record<string, unknown>)
      : undefined;
  }

  listByConversation(
    conversationId: string,
  ): ConversationClarification[] {
    return this.db
      .prepare(
        "SELECT * FROM conversation_clarifications WHERE conversation_id = ? ORDER BY created_at DESC",
      )
      .all(conversationId)
      .map((row) =>
        rowToClarification(row as unknown as Record<string, unknown>),
      );
  }
}
