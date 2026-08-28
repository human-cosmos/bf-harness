import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ArtifactRepository } from "../src/repositories/artifact-repository.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";

describe("ArtifactRepository", () => {
  it("persists redacted artifact metadata", () => {
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
      title: "fix",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
    });

    const id = new ArtifactRepository(db).save({
      taskId: task.id,
      kind: "log",
      path: "/tmp/log.txt",
      metadata: { token: "Bearer abcdefghijklmnop" },
    });
    expect(id).toBeTruthy();
  });
});
