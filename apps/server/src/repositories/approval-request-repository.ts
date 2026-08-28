import { randomUUID } from "node:crypto";
import type { RiskLevel } from "../services/approval-policy.js";
import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

export interface ApprovalRecord {
  id: string;
  taskId: string;
  workflowRunId?: string;
  codexRequestId?: number;
  method: string;
  payload: unknown;
  riskLevel: RiskLevel;
  decision?: "accept" | "decline" | "cancel";
  decidedAt?: string;
  createdAt: string;
}

export class ApprovalRequestRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    taskId: string;
    workflowRunId?: string;
    codexRequestId?: number;
    method: string;
    payload: unknown;
    riskLevel: RiskLevel;
  }): ApprovalRecord {
    const record: ApprovalRecord = {
      id: randomUUID(),
      taskId: input.taskId,
      workflowRunId: input.workflowRunId,
      codexRequestId: input.codexRequestId,
      method: input.method,
      payload: input.payload,
      riskLevel: input.riskLevel,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO approval_requests(
          id, task_id, workflow_run_id, codex_request_id, method, payload_json,
          risk_level, decision, decided_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.workflowRunId ?? null,
        record.codexRequestId ?? null,
        record.method,
        JSON.stringify(redactObject(record.payload)),
        record.riskLevel,
        record.createdAt,
      );

    return record;
  }

  decide(
    id: string,
    decision: "accept" | "decline" | "cancel",
  ): void {
    this.db
      .prepare(
        "UPDATE approval_requests SET decision = ?, decided_at = ? WHERE id = ?",
      )
      .run(decision, new Date().toISOString(), id);
  }

  listByTask(taskId: string): ApprovalRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM approval_requests WHERE task_id = ? ORDER BY created_at DESC",
      )
      .all(taskId)
      .map((row) => this.rowToRecord(row as unknown as Record<string, unknown>));
  }

  private rowToRecord(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      workflowRunId: row.workflow_run_id
        ? String(row.workflow_run_id)
        : undefined,
      codexRequestId:
        row.codex_request_id === null ? undefined : Number(row.codex_request_id),
      method: String(row.method),
      payload: JSON.parse(String(row.payload_json)),
      riskLevel: String(row.risk_level) as RiskLevel,
      decision: row.decision
        ? (String(row.decision) as "accept" | "decline" | "cancel")
        : undefined,
      decidedAt: row.decided_at ? String(row.decided_at) : undefined,
      createdAt: String(row.created_at),
    };
  }
}
