import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ArtifactRepository } from "../src/repositories/artifact-repository.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { FileCleanupExecutor } from "../src/services/file-cleanup-executor.js";

describe("FileCleanupExecutor", () => {
  it("requires confirmation and deletes task artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-cleanup-"));
    const db = openDatabase(":memory:");
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);
    const artifacts = new ArtifactRepository(db);
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
    const file = join(root, "log.txt");
    writeFileSync(file, "log");
    artifacts.save({ taskId: task.id, kind: "log", path: file, metadata: {} });

    const executor = new FileCleanupExecutor(artifacts);
    expect(() =>
      executor.cleanupTaskArtifacts(task.id, { confirmed: false }),
    ).toThrow();

    const result = executor.cleanupTaskArtifacts(task.id, { confirmed: true });
    expect(result.deletedFiles).toContain(file);
    expect(result.deletedRecords).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });
});
