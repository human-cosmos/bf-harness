import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import type { ValidationOutcome } from "../services/validation-runner.js";
import { redactSensitive } from "../services/redaction.js";

export class ValidationResultRepository {
  constructor(private readonly db: AppDatabase) {}

  save(
    taskId: string,
    outcome: ValidationOutcome,
    workflowRunId?: string,
    validationRunId?: string,
  ) {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO validation_results(
          id, task_id, workflow_run_id, command_id, command, cwd,
          started_at, finished_at, exit_code, status, stdout, stderr,
          skip_reason, created_at, validation_run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        taskId,
        workflowRunId ?? null,
        outcome.command.id,
        JSON.stringify(outcome.command.command),
        outcome.cwd,
        outcome.startedAt,
        outcome.finishedAt,
        outcome.exitCode,
        outcome.status,
        redactSensitive(outcome.stdout),
        redactSensitive(outcome.stderr),
        outcome.skipReason ?? null,
        new Date().toISOString(),
        validationRunId ?? null,
      );
    return id;
  }

  listByTask(taskId: string): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        "SELECT * FROM validation_results WHERE task_id = ? ORDER BY created_at DESC",
      )
      .all(taskId)
      .map((row) => row as unknown as Record<string, unknown>);
  }
}
