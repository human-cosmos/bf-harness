import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { AgentEventRepository } from "../src/repositories/agent-event-repository.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";

function createTask(db: ReturnType<typeof openDatabase>) {
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
  return tasks.create({
    projectId: project.id,
    title: "fix",
    bugDescription: "broken",
    observedBehavior: "error",
    expectedBehavior: "works",
    relatedFiles: [],
    acceptanceCriteria: [],
    constraints: [],
  });
}

describe("AgentEventRepository logs", () => {
  it("persists and filters classified log entries", () => {
    const db = openDatabase(":memory:");
    const task = createTask(db);
    const events = new AgentEventRepository(db);

    events.append({
      taskId: task.id,
      method: "thread/started",
      payload: { ok: true },
      level: "info",
      source: "runtime",
      phase: "analyze",
      message: "启动分析会话",
    });
    events.append({
      taskId: task.id,
      method: "job.failed",
      payload: { error: "boom" },
      level: "error",
      source: "workflow",
      phase: "lifecycle",
      message: "后台任务失败",
    });
    events.append({
      taskId: task.id,
      method: "item/reasoning/textDelta",
      payload: { delta: "x" },
      level: "debug",
      source: "runtime",
      phase: "analyze",
      message: "item/reasoning/textDelta",
    });

    const errors = events.listLogsByTask(task.id, { level: "error" });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("后台任务失败");
    expect(errors[0].payload).toEqual({ error: "boom" });

    const runtimeAnalyze = events.listLogsByTask(task.id, {
      source: "runtime",
      phase: "analyze",
      limit: 1,
    });
    expect(runtimeAnalyze).toHaveLength(1);
    expect(runtimeAnalyze[0].seq).toBe(1);
  });
});

describe("task logs endpoint", () => {
  it("returns paginated logs and rejects invalid filters", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-task-logs-"));
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const project = service.projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const task = service.tasks.create({
      projectId: project.id,
      title: "fix",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
    });

    service.agentEvents.append({
      taskId: task.id,
      method: "a",
      payload: {},
      level: "info",
      source: "runtime",
      phase: "analyze",
      message: "first",
    });
    service.agentEvents.append({
      taskId: task.id,
      method: "b",
      payload: {},
      level: "info",
      source: "runtime",
      phase: "analyze",
      message: "second",
    });
    service.agentEvents.append({
      taskId: task.id,
      method: "c",
      payload: {},
      level: "info",
      source: "runtime",
      phase: "analyze",
      message: "third",
    });

    const app = await buildApp(service);
    try {
      const firstPage = await app.inject({
        method: "GET",
        url: `/api/tasks/${task.id}/logs?limit=2`,
      });
      expect(firstPage.statusCode).toBe(200);
      const firstBody = firstPage.json() as {
        items: Array<{ seq: number }>;
        nextAfterSeq: number | null;
      };
      expect(firstBody.items).toHaveLength(2);
      expect(firstBody.nextAfterSeq).toBe(2);

      const secondPage = await app.inject({
        method: "GET",
        url: `/api/tasks/${task.id}/logs?limit=2&afterSeq=${firstBody.nextAfterSeq}`,
      });
      const secondBody = secondPage.json() as {
        items: Array<{ seq: number }>;
        nextAfterSeq: number | null;
      };
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.nextAfterSeq).toBeNull();

      const invalid = await app.inject({
        method: "GET",
        url: `/api/tasks/${task.id}/logs?level=unknown`,
      });
      expect(invalid.statusCode).toBe(400);

      const invalidLimit = await app.inject({
        method: "GET",
        url: `/api/tasks/${task.id}/logs?limit=0`,
      });
      expect(invalidLimit.statusCode).toBe(400);

      const invalidAfterSeq = await app.inject({
        method: "GET",
        url: `/api/tasks/${task.id}/logs?afterSeq=-1`,
      });
      expect(invalidAfterSeq.statusCode).toBe(400);
    } finally {
      await app.close();
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("persists task lifecycle domain events", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-task-log-events-"));
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const project = service.projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const { task } = await service.createTask({
      projectId: project.id,
      title: "fix",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
    });

    const logs = service.agentEvents.listLogsByTask(task.id, {
      source: "workflow",
    });
    expect(logs.some((log) => log.method === "task.created")).toBe(true);

    service.workflow.transitionTask(task.id, "PREPARING_WORKSPACE");
    const statusLogs = service.agentEvents.listLogsByTask(task.id, {
      source: "workflow",
      phase: "lifecycle",
    });
    expect(
      statusLogs.some(
        (log) =>
          log.method === "task.status_changed" &&
          String(log.message).includes("PREPARING_WORKSPACE"),
      ),
    ).toBe(true);

    rmSync(worktreeRoot, { recursive: true, force: true });
    db.close();
  });
});
