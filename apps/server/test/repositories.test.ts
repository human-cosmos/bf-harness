import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { WorktreeRepository } from "../src/repositories/worktree-repository.js";

describe("repositories", () => {
  it("persists projects and tasks", () => {
    const db = openDatabase(":memory:");
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);

    const project = projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });

    const task = tasks.create({
      projectId: project.id,
      title: "Fix bug",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      acceptanceCriteria: ["test passes"],
      constraints: [],
      relatedFiles: [],
    });

    expect(projects.list()).toHaveLength(1);
    expect(tasks.list(project.id)).toHaveLength(1);
    expect(tasks.get(task.id)?.status).toBe("DRAFT");
  });

  it("persists worktree records", () => {
    const db = openDatabase(":memory:");
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);
    const worktrees = new WorktreeRepository(db);

    const project = projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const task = tasks.create({
      projectId: project.id,
      title: "Fix bug",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
    });

    const worktree = worktrees.create({
      taskId: task.id,
      projectId: project.id,
      path: "/tmp/worktree",
      baseCommit: "abc123",
      branch: `harness/${task.id}`,
    });

    expect(worktree.status).toBe("CREATING");
    worktrees.updateStatus(worktree.id, "READY");
    expect(worktrees.getByTaskId(task.id)?.status).toBe("READY");
  });

  it("removes every associated child record when a task is deleted", () => {
    const db = openDatabase(":memory:");
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);

    const project = projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const task = tasks.create({
      projectId: project.id,
      title: "Fix bug",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
    });

    const run = db
      .prepare(
        "INSERT INTO workflow_runs(id, task_id, started_at, finished_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("run-1", task.id, "now", null, "RUNNING", "now", "now");
    expect(run.changes).toBe(1);

    const inserts: Array<{ sql: string; params: Array<string | number | null> }> = [
      {
        sql: "INSERT INTO task_contracts(id, task_id, schema_version, goal, observed_behavior, expected_behavior, reproduction, acceptance_criteria, constraints, allowed_paths, forbidden_paths, validation_commands, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          "contract-1",
          task.id,
          "1.0",
          "goal",
          "observed",
          "expected",
          null,
          "[]",
          "[]",
          "[]",
          "[]",
          "[]",
          "now",
        ],
      },
      {
        sql: "INSERT INTO worktrees(id, task_id, project_id, path, base_commit, branch, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          "worktree-1",
          task.id,
          project.id,
          "/tmp/worktree-1",
          "abc123",
          "harness/1",
          "READY",
          null,
          "now",
          "now",
        ],
      },
      {
        sql: "INSERT INTO stage_runs(id, workflow_run_id, stage, status, started_at, finished_at, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          "stage-1",
          "run-1",
          "analyze",
          "RUNNING",
          "now",
          null,
          null,
          "now",
          "now",
        ],
      },
      {
        sql: "INSERT INTO agent_sessions(id, task_id, workflow_run_id, codex_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: ["session-1", task.id, "run-1", "thread-1", "now", "now"],
      },
      {
        sql: "INSERT INTO agent_events(task_id, workflow_run_id, codex_thread_id, codex_turn_id, codex_item_id, method, payload_json, seq, emitted_at_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          task.id,
          "run-1",
          "thread-1",
          "turn-1",
          "item-1",
          "test",
          "{}",
          1,
          1,
          "now",
        ],
      },
      {
        sql: "INSERT INTO approval_requests(id, task_id, workflow_run_id, codex_request_id, method, payload_json, risk_level, decision, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          "approval-1",
          task.id,
          "run-1",
          1,
          "test",
          "{}",
          "medium",
          null,
          null,
          "now",
        ],
      },
      {
        sql: "INSERT INTO validation_results(id, task_id, workflow_run_id, command_id, command, cwd, started_at, finished_at, exit_code, status, stdout, stderr, skip_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          "validation-1",
          task.id,
          "run-1",
          "test",
          "[]",
          "/tmp",
          "now",
          "now",
          0,
          "passed",
          "",
          "",
          null,
          "now",
        ],
      },
      {
        sql: "INSERT INTO artifacts(id, task_id, kind, path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: ["artifact-1", task.id, "log", "/tmp/log", "{}", "now"],
      },
      {
        sql: "INSERT INTO delivery_reports(id, task_id, content_json, created_at) VALUES (?, ?, ?, ?)",
        params: ["report-1", task.id, "{}", "now"],
      },
      {
        sql: "INSERT INTO plan_approvals(id, task_id, content_json, status, comment, created_at, decided_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          "plan-1",
          task.id,
          "{}",
          "PENDING",
          null,
          "now",
          null,
          "now",
        ],
      },
    ];

    for (const insert of inserts) {
      expect(db.prepare(insert.sql).run(...insert.params).changes).toBe(1);
    }

    expect(tasks.delete(task.id)).toBe(true);

    const count = (sql: string, param = task.id) => {
      const row = db.prepare(sql).get(param) as { count: number | bigint };
      return Number(row.count);
    };
    expect(count("SELECT COUNT(*) AS count FROM tasks WHERE id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM task_contracts WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM worktrees WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM workflow_runs WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM stage_runs WHERE workflow_run_id = ?", "run-1")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM agent_sessions WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM agent_events WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM approval_requests WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM validation_results WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM artifacts WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM delivery_reports WHERE task_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS count FROM plan_approvals WHERE task_id = ?")).toBe(0);
    expect(projects.get(project.id)).toBeDefined();
  });
});
