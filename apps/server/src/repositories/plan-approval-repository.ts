import { randomUUID } from "node:crypto";
import type { RepairPlan } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

export type PlanApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PlanApproval {
  id: string;
  taskId: string;
  content: RepairPlan;
  status: PlanApprovalStatus;
  comment?: string;
  createdAt: string;
  decidedAt?: string;
  updatedAt: string;
}

function rowToPlanApproval(row: Record<string, unknown>): PlanApproval {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    content: JSON.parse(String(row.content_json)) as RepairPlan,
    status: String(row.status) as PlanApprovalStatus,
    comment: row.comment ? String(row.comment) : undefined,
    createdAt: String(row.created_at),
    decidedAt: row.decided_at ? String(row.decided_at) : undefined,
    updatedAt: String(row.updated_at),
  };
}

export class PlanApprovalRepository {
  constructor(private readonly db: AppDatabase) {}

  create(taskId: string, content: RepairPlan): PlanApproval {
    const now = new Date().toISOString();
    const approval: PlanApproval = {
      id: randomUUID(),
      taskId,
      content,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO plan_approvals(
          id, task_id, content_json, status, created_at, decided_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        approval.id,
        approval.taskId,
        JSON.stringify(approval.content),
        approval.status,
        approval.createdAt,
        approval.updatedAt,
      );

    return approval;
  }

  getLatest(taskId: string): PlanApproval | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM plan_approvals WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(taskId);
    return row ? rowToPlanApproval(row as unknown as Record<string, unknown>) : undefined;
  }

  decide(
    id: string,
    status: "APPROVED" | "REJECTED",
    comment?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE plan_approvals
         SET status = ?, comment = ?, decided_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        comment ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
        id,
      );
  }
}
