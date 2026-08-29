import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("returns the existing worktree when prepareWorktree is called again", async () => {
    const { db, service, worktreeRoot } = createService();
    const repo = mkdtempSync(join(tmpdir(), "bugfix-service-repo-"));
    try {
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.email", "t@example.com"]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
      writeFileSync(join(repo, "README.md"), "# test\n");
      execFileSync("git", ["-C", repo, "add", "README.md"]);
      execFileSync("git", ["-C", repo, "commit", "-m", "baseline"]);

      const project = await service.createProject({
        name: "idempotent",
        repoPath: repo,
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [repo],
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

      const first = await service.prepareWorktree(task.id);
      const second = await service.prepareWorktree(task.id);

      expect(first.id).toBe(second.id);
      expect(second.status).toBe("READY");
      expect(service.worktrees.getByTaskId(task.id)?.status).toBe("READY");
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("recreates the worktree when the directory is missing but the branch remains", async () => {
    const { db, service, worktreeRoot } = createService();
    const repo = mkdtempSync(join(tmpdir(), "bugfix-service-repo-"));
    try {
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.email", "t@example.com"]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
      writeFileSync(join(repo, "README.md"), "# test\n");
      execFileSync("git", ["-C", repo, "add", "README.md"]);
      execFileSync("git", ["-C", repo, "commit", "-m", "baseline"]);

      const project = await service.createProject({
        name: "recreate",
        repoPath: repo,
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [repo],
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

      const first = await service.prepareWorktree(task.id);
      rmSync(first.path, { recursive: true, force: true });
      const second = await service.prepareWorktree(task.id);

      expect(second.id).toBe(first.id);
      expect(second.status).toBe("READY");
      expect(service.worktrees.getByTaskId(task.id)?.path).toBe(first.path);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("refreshes baseCommit and publishes worktree.ready when directory and branch are gone", async () => {
    const { db, service, worktreeRoot } = createService();
    const repo = mkdtempSync(join(tmpdir(), "bugfix-service-repo-"));
    try {
      execFileSync("git", ["init", repo]);
      execFileSync("git", ["-C", repo, "config", "user.email", "t@example.com"]);
      execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
      writeFileSync(join(repo, "README.md"), "# test\n");
      execFileSync("git", ["-C", repo, "add", "README.md"]);
      execFileSync("git", ["-C", repo, "commit", "-m", "baseline"]);

      const project = await service.createProject({
        name: "recreate-branch",
        repoPath: repo,
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [repo],
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

      const first = await service.prepareWorktree(task.id);
      const firstCommit = first.baseCommit;

      execFileSync("git", ["-C", repo, "worktree", "remove", "--force", first.path]);
      execFileSync("git", ["-C", repo, "branch", "-D", first.branch]);
      writeFileSync(join(repo, "README.md"), "# test v2\n");
      execFileSync("git", ["-C", repo, "add", "README.md"]);
      execFileSync("git", ["-C", repo, "commit", "-m", "advance"]);
      const newHead = execFileSync("git", [
        "-C",
        repo,
        "rev-parse",
        "HEAD",
      ])
        .toString()
        .trim();

      const events: string[] = [];
      const unsubscribe = service.events.subscribe((event) => {
        if (event.taskId === task.id && event.type === "worktree.ready") {
          events.push(event.type);
        }
      });

      const second = await service.prepareWorktree(task.id);
      unsubscribe();

      expect(second.id).toBe(first.id);
      expect(second.status).toBe("READY");
      expect(second.baseCommit).toBe(newHead);
      expect(second.baseCommit).not.toBe(firstCommit);
      expect(events).toContain("worktree.ready");
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });
});
