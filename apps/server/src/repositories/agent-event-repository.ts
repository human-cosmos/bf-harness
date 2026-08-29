import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";
import type {
  TaskLogLevel,
  TaskLogPhase,
  TaskLogSource,
} from "../services/task-log-classifier.js";

export interface AgentEventInput {
  taskId: string;
  workflowRunId?: string;
  codexThreadId?: string;
  codexTurnId?: string;
  codexItemId?: string;
  method: string;
  payload: unknown;
  emittedAtMs?: number;
  level?: TaskLogLevel;
  source?: TaskLogSource;
  phase?: TaskLogPhase;
  message?: string;
}

export class AgentEventRepository {
  constructor(private readonly db: AppDatabase) {}

  append(input: AgentEventInput): number {
    const seqRow = this.db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM agent_events WHERE task_id = ?",
      )
      .get(input.taskId) as { next_seq: number | bigint } | undefined;
    const nextSeq = Number(seqRow?.next_seq ?? 1);

    const result = this.db
      .prepare(
        `INSERT INTO agent_events(
          task_id, workflow_run_id, codex_thread_id, codex_turn_id,
          codex_item_id, method, payload_json, seq, emitted_at_ms, created_at,
          level, source, phase, message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.taskId,
        input.workflowRunId ?? null,
        input.codexThreadId ?? null,
        input.codexTurnId ?? null,
        input.codexItemId ?? null,
        input.method,
        JSON.stringify(redactObject(input.payload)),
        nextSeq,
        input.emittedAtMs ?? null,
        new Date().toISOString(),
        input.level ?? "debug",
        input.source ?? "runtime",
        input.phase ?? "lifecycle",
        input.message ?? "",
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

  listLogsByTask(
    taskId: string,
    options: {
      afterSeq?: number;
      limit?: number;
      level?: TaskLogLevel;
      source?: TaskLogSource;
      phase?: TaskLogPhase;
    } = {},
  ): Array<Record<string, unknown>> {
    const limit = options.limit ?? 100;
    const afterSeq = options.afterSeq ?? 0;
    const clauses = ["task_id = ?", "seq > ?"];
    const params: Array<string | number> = [taskId, afterSeq];

    if (options.level) {
      clauses.push("level = ?");
      params.push(options.level);
    }
    if (options.source) {
      clauses.push("source = ?");
      params.push(options.source);
    }
    if (options.phase) {
      clauses.push("phase = ?");
      params.push(options.phase);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapLogRow(row));
  }

  private mapLogRow(row: Record<string, unknown>): Record<string, unknown> {
    let payload: unknown = null;
    try {
      payload = JSON.parse(String(row.payload_json ?? "null"));
    } catch {
      payload = row.payload_json;
    }

    return {
      id: row.id,
      taskId: row.task_id,
      seq: row.seq,
      level: row.level,
      source: row.source,
      phase: row.phase,
      method: row.method,
      message: row.message,
      payload,
      codexThreadId: row.codex_thread_id ?? null,
      codexTurnId: row.codex_turn_id ?? null,
      codexItemId: row.codex_item_id ?? null,
      emittedAtMs: row.emitted_at_ms ?? null,
      createdAt: row.created_at,
    };
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
