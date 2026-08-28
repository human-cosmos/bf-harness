import { randomUUID } from "node:crypto";
import type {
  BugfixTask,
  CreateBugfixTaskInput,
  TaskContract,
  TaskStatus,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function rowToTask(row: Record<string, unknown>): BugfixTask {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    bugDescription: String(row.bug_description),
    observedBehavior: String(row.observed_behavior),
    expectedBehavior: String(row.expected_behavior),
    reproductionSteps: row.reproduction_steps
      ? String(row.reproduction_steps)
      : undefined,
    reproductionCommand: row.reproduction_command
      ? String(row.reproduction_command)
      : undefined,
    logs: row.logs ? String(row.logs) : undefined,
    relatedFiles: parseJson(String(row.related_files)),
    acceptanceCriteria: parseJson(String(row.acceptance_criteria)),
    constraints: parseJson(String(row.constraints)),
    status: String(row.status) as TaskStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class TaskRepository {
  constructor(private readonly db: AppDatabase) {}

  list(projectId?: string): BugfixTask[] {
    if (projectId) {
      return this.db
        .prepare(
          "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC",
        )
        .all(projectId)
        .map((row) => rowToTask(row as unknown as Record<string, unknown>));
    }

    return this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
      .all()
      .map((row) => rowToTask(row as unknown as Record<string, unknown>));
  }

  get(id: string): BugfixTask | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? rowToTask(row as unknown as Record<string, unknown>) : undefined;
  }

  create(input: CreateBugfixTaskInput): BugfixTask {
    const now = new Date().toISOString();
    const task: BugfixTask = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      bugDescription: input.bugDescription,
      observedBehavior: input.observedBehavior,
      expectedBehavior: input.expectedBehavior,
      reproductionSteps: input.reproductionSteps,
      reproductionCommand: input.reproductionCommand,
      logs: input.logs,
      relatedFiles: input.relatedFiles ?? [],
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      constraints: input.constraints ?? [],
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO tasks(
          id, project_id, title, bug_description, observed_behavior,
          expected_behavior, reproduction_steps, reproduction_command, logs,
          related_files, acceptance_criteria, constraints, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.bugDescription,
        task.observedBehavior,
        task.expectedBehavior,
        task.reproductionSteps ?? null,
        task.reproductionCommand ?? null,
        task.logs ?? null,
        JSON.stringify(task.relatedFiles),
        JSON.stringify(task.acceptanceCriteria),
        JSON.stringify(task.constraints),
        task.status,
        task.createdAt,
        task.updatedAt,
      );

    return task;
  }

  saveContract(taskId: string, contract: TaskContract): void {
    this.db
      .prepare(
        `INSERT INTO task_contracts(
          id, task_id, schema_version, goal, observed_behavior, expected_behavior,
          reproduction, acceptance_criteria, constraints, allowed_paths,
          forbidden_paths, validation_commands, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        taskId,
        contract.schemaVersion,
        contract.goal,
        contract.observedBehavior,
        contract.expectedBehavior,
        contract.reproduction ?? null,
        JSON.stringify(contract.acceptanceCriteria),
        JSON.stringify(contract.constraints),
        JSON.stringify(contract.scope.allowedPaths),
        JSON.stringify(contract.scope.forbiddenPaths),
        JSON.stringify(contract.validationCommands),
        new Date().toISOString(),
      );
  }

  getContract(taskId: string): TaskContract | undefined {
    const row = this.db
      .prepare("SELECT * FROM task_contracts WHERE task_id = ? ORDER BY created_at DESC")
      .get(taskId);
    if (!row) {
      return undefined;
    }
    const record = row as unknown as Record<string, unknown>;
    return {
      schemaVersion: String(record.schema_version) as "1.0",
      goal: String(record.goal),
      observedBehavior: String(record.observed_behavior),
      expectedBehavior: String(record.expected_behavior),
      reproduction: record.reproduction ? String(record.reproduction) : undefined,
      acceptanceCriteria: parseJson(String(record.acceptance_criteria)),
      constraints: parseJson(String(record.constraints)),
      scope: {
        allowedPaths: parseJson(String(record.allowed_paths)),
        forbiddenPaths: parseJson(String(record.forbidden_paths)),
      },
      validationCommands: parseJson(String(record.validation_commands)),
    };
  }

  updateStatus(taskId: string, status: TaskStatus): void {
    this.db
      .prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), taskId);
  }

  delete(taskId: string): boolean {
    const deleteChildRows = (sql: string, params: any[]) => {
      this.db.prepare(sql).run(...params);
    };

    this.db.exec("BEGIN");
    try {
      const workflowRunIds = this.db
        .prepare("SELECT id FROM workflow_runs WHERE task_id = ?")
        .all(taskId) as Array<{ id: string }>;
      for (const run of workflowRunIds) {
        deleteChildRows("DELETE FROM stage_runs WHERE workflow_run_id = ?", [
          run.id,
        ]);
      }
      deleteChildRows("DELETE FROM agent_sessions WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM agent_events WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM approval_requests WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM validation_results WHERE task_id = ?", [
        taskId,
      ]);
      deleteChildRows("DELETE FROM workflow_runs WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM worktrees WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM task_contracts WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM artifacts WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM delivery_reports WHERE task_id = ?", [taskId]);
      deleteChildRows("DELETE FROM plan_approvals WHERE task_id = ?", [taskId]);
      const result = this.db
        .prepare("DELETE FROM tasks WHERE id = ?")
        .run(taskId);
      this.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
