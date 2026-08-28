import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db.js";
import { EventBus } from "../src/services/event-bus.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { WorktreeRepository } from "../src/repositories/worktree-repository.js";

function createService() {
  const db = openDatabase(":memory:");
  const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-service-"));
  const service = new BugfixService({
    db,
    worktreeRoot,
    eventBus: new EventBus(),
  });
  return { db, service, worktreeRoot };
}

describe("BugfixService", () => {
  it("deletes a project together with its tasks without foreign key errors", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
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
      const worktrees = new WorktreeRepository(db);
      worktrees.create({
        taskId: task.id,
        projectId: project.id,
        path: `${worktreeRoot}/${task.id}`,
        baseCommit: "abc123",
        branch: `harness/${task.id}`,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const result = await service.deleteProject(project.id);
        expect(result.deleted).toBe(true);
        expect(service.projects.list()).toHaveLength(0);
        expect(service.tasks.list(project.id)).toHaveLength(0);
        expect(worktrees.getByTaskId(task.id)).toBeUndefined();
      } finally {
        warn.mockRestore();
      }
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("rejects deleting an unknown project", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
      await expect(service.deleteProject("missing-project")).rejects.toThrow(
        "Project not found",
      );
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("deletes a task together with its associated worktree record", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
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
      const worktrees = new WorktreeRepository(db);
      worktrees.create({
        taskId: task.id,
        projectId: project.id,
        path: `${worktreeRoot}/${task.id}`,
        baseCommit: "abc123",
        branch: `harness/${task.id}`,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const result = await service.deleteTask(task.id);
        expect(result.deleted).toBe(true);
        expect(service.tasks.get(task.id)).toBeUndefined();
        expect(worktrees.getByTaskId(task.id)).toBeUndefined();
        expect(service.projects.get(project.id)).toBeDefined();
      } finally {
        warn.mockRestore();
      }
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("rejects a second background job of the same kind for the same task", () => {
    const { service } = createService();
    service.startValidationJob("task-1");
    expect(() => service.startValidationJob("task-1")).toThrow(
      /validate job is already running/,
    );
  });
});
