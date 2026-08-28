import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AppDatabase = DatabaseSync;

export function openDatabase(path: string): AppDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const versionRow = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number | bigint } | undefined;
  const current = Number(versionRow?.version ?? 0);

  const migrations: Array<{ version: number; sql: string }> = [
    {
      version: 1,
      sql: `
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          repo_path TEXT NOT NULL UNIQUE,
          instruction_sources TEXT NOT NULL,
          validation_commands TEXT NOT NULL,
          allowed_paths TEXT NOT NULL,
          forbidden_paths TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          title TEXT NOT NULL,
          bug_description TEXT NOT NULL,
          observed_behavior TEXT NOT NULL,
          expected_behavior TEXT NOT NULL,
          reproduction_steps TEXT,
          reproduction_command TEXT,
          logs TEXT,
          related_files TEXT NOT NULL,
          acceptance_criteria TEXT NOT NULL,
          constraints TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE task_contracts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          schema_version TEXT NOT NULL,
          goal TEXT NOT NULL,
          observed_behavior TEXT NOT NULL,
          expected_behavior TEXT NOT NULL,
          reproduction TEXT,
          acceptance_criteria TEXT NOT NULL,
          constraints TEXT NOT NULL,
          allowed_paths TEXT NOT NULL,
          forbidden_paths TEXT NOT NULL,
          validation_commands TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE worktrees (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          project_id TEXT NOT NULL REFERENCES projects(id),
          path TEXT NOT NULL UNIQUE,
          base_commit TEXT NOT NULL,
          branch TEXT NOT NULL,
          status TEXT NOT NULL,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE workflow_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE stage_runs (
          id TEXT PRIMARY KEY,
          workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
          stage TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE agent_sessions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          workflow_run_id TEXT REFERENCES workflow_runs(id),
          codex_thread_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE agent_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          workflow_run_id TEXT REFERENCES workflow_runs(id),
          codex_thread_id TEXT,
          codex_turn_id TEXT,
          codex_item_id TEXT,
          method TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          seq INTEGER NOT NULL,
          emitted_at_ms INTEGER,
          created_at TEXT NOT NULL
        );

        CREATE TABLE approval_requests (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          workflow_run_id TEXT REFERENCES workflow_runs(id),
          codex_request_id INTEGER,
          method TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          decision TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE validation_results (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          workflow_run_id TEXT REFERENCES workflow_runs(id),
          command_id TEXT NOT NULL,
          command TEXT NOT NULL,
          cwd TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT NOT NULL,
          exit_code INTEGER,
          status TEXT NOT NULL,
          stdout TEXT NOT NULL,
          stderr TEXT NOT NULL,
          skip_reason TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE artifacts (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          kind TEXT NOT NULL,
          path TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE delivery_reports (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_tasks_project ON tasks(project_id);
        CREATE INDEX idx_tasks_status ON tasks(status);
        CREATE INDEX idx_worktrees_task ON worktrees(task_id);
        CREATE INDEX idx_agent_events_task_seq ON agent_events(task_id, seq);
        CREATE INDEX idx_approval_requests_task ON approval_requests(task_id);
        CREATE INDEX idx_validation_results_task ON validation_results(task_id);
      `,
    },
    {
      version: 2,
      sql: `
        CREATE TABLE plan_approvals (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id),
          content_json TEXT NOT NULL,
          status TEXT NOT NULL,
          comment TEXT,
          created_at TEXT NOT NULL,
          decided_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_plan_approvals_task ON plan_approvals(task_id);
      `,
    },
  ];

  for (const migration of migrations) {
    if (migration.version <= current) {
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
      ).run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
