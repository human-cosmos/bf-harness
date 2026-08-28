import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

export interface AgentEventInput {
  taskId: string;
  workflowRunId?: string;
  codexThreadId?: string;
  codexTurnId?: string;
  codexItemId?: string;
  method: string;
  payload: unknown;
  seq: number;
  emittedAtMs?: number;
}

export class AgentEventRepository {
  constructor(private readonly db: AppDatabase) {}

  append(input: AgentEventInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO agent_events(
          task_id, workflow_run_id, codex_thread_id, codex_turn_id,
          codex_item_id, method, payload_json, seq, emitted_at_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.taskId,
        input.workflowRunId ?? null,
        input.codexThreadId ?? null,
        input.codexTurnId ?? null,
        input.codexItemId ?? null,
        input.method,
        JSON.stringify(redactObject(input.payload)),
        input.seq,
        input.emittedAtMs ?? null,
        new Date().toISOString(),
      );
    return Number(result.lastInsertRowid);
  }

  listByTask(
    taskId: string,
    options: { limit?: number; afterSeq?: number } = {},
  ): Array<Record<string, unknown>> {
    const limit = options.limit ?? 100;
    const afterSeq = options.afterSeq ?? 0;
    return this.db
      .prepare(
        `SELECT * FROM agent_events
         WHERE task_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(taskId, afterSeq, limit)
      .map((row) => row as unknown as Record<string, unknown>);
  }

  countByTask(taskId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM agent_events WHERE task_id = ?")
      .get(taskId) as { count: number | bigint };
    return Number(row.count);
  }

  pruneToRecent(taskId: string, maxEvents: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM agent_events
         WHERE task_id = ?
           AND seq NOT IN (
             SELECT seq FROM agent_events
             WHERE task_id = ?
             ORDER BY seq DESC
             LIMIT ?
           )`,
      )
      .run(taskId, taskId, maxEvents);
    return Number(result.changes);
  }
}
