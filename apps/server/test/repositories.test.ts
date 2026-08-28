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
});
