import { randomUUID } from "node:crypto";
import type { ConversationApproval } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

function rowToApproval(row: Record<string, unknown>): ConversationApproval {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    codexTurnId: row.codex_turn_id ? String(row.codex_turn_id) : null,
    codexItemId: row.codex_item_id ? String(row.codex_item_id) : null,
    codexRequestId:
      row.codex_request_id === null ? null : Number(row.codex_request_id),
    method: String(row.method),
    kind: String(row.kind),
    payload: JSON.parse(String(row.payload_json)),
    riskLevel: String(row.risk_level),
    decision: row.decision ? String(row.decision) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    createdAt: String(row.created_at),
  };
}

export class ConversationApprovalRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    conversationId: string;
    codexTurnId?: string | null;
    codexItemId?: string | null;
    codexRequestId?: number | null;
    method: string;
    kind: string;
    payload: unknown;
    riskLevel: string;
  }): ConversationApproval {
    const approval: ConversationApproval = {
      id: randomUUID(),
      conversationId: input.conversationId,
      codexTurnId: input.codexTurnId ?? null,
      codexItemId: input.codexItemId ?? null,
      codexRequestId: input.codexRequestId ?? null,
      method: input.method,
      kind: input.kind,
      payload: input.payload,
      riskLevel: input.riskLevel,
      decision: null,
      decidedAt: null,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO conversation_approvals(
          id, conversation_id, codex_turn_id, codex_item_id, codex_request_id,
          method, kind, payload_json, risk_level, decision, decided_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        approval.id,
        approval.conversationId,
        approval.codexTurnId,
        approval.codexItemId,
        approval.codexRequestId,
        approval.method,
        approval.kind,
        JSON.stringify(redactObject(approval.payload)),
        approval.riskLevel,
        approval.createdAt,
      );

    return approval;
  }

  get(id: string): ConversationApproval | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversation_approvals WHERE id = ?")
      .get(id);
    return row
      ? rowToApproval(row as unknown as Record<string, unknown>)
      : undefined;
  }

  decide(id: string, decision: string): void {
    this.db
      .prepare(
        "UPDATE conversation_approvals SET decision = ?, decided_at = ? WHERE id = ?",
      )
      .run(decision, new Date().toISOString(), id);
  }

  listByConversation(
    conversationId: string,
    options: { pendingOnly?: boolean } = {},
  ): ConversationApproval[] {
    const pendingOnly = options.pendingOnly ?? false;
    const sql = pendingOnly
      ? "SELECT * FROM conversation_approvals WHERE conversation_id = ? AND decision IS NULL ORDER BY created_at DESC"
      : "SELECT * FROM conversation_approvals WHERE conversation_id = ? ORDER BY created_at DESC";
    return this.db
      .prepare(sql)
      .all(conversationId)
      .map((row) =>
        rowToApproval(row as unknown as Record<string, unknown>),
      );
  }
}
