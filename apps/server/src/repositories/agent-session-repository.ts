import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";

export interface AgentSession {
  id: string;
  taskId: string;
  workflowRunId?: string;
  codexThreadId: string;
  createdAt: string;
  updatedAt: string;
}

export class AgentSessionRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    taskId: string;
    workflowRunId?: string;
    codexThreadId: string;
  }): AgentSession {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: randomUUID(),
      taskId: input.taskId,
      workflowRunId: input.workflowRunId,
      codexThreadId: input.codexThreadId,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO agent_sessions(
          id, task_id, workflow_run_id, codex_thread_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.taskId,
        session.workflowRunId ?? null,
        session.codexThreadId,
        session.createdAt,
        session.updatedAt,
      );

    return session;
  }

  getLatest(taskId: string): AgentSession | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM agent_sessions WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(taskId) as unknown as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      workflowRunId: row.workflow_run_id
        ? String(row.workflow_run_id)
        : undefined,
      codexThreadId: String(row.codex_thread_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
