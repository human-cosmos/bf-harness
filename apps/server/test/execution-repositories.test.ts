import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ApprovalRequestRepository } from "../src/repositories/approval-request-repository.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { ValidationResultRepository } from "../src/repositories/validation-result-repository.js";

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
    title: "Fix bug",
    bugDescription: "broken",
    observedBehavior: "error",
    expectedBehavior: "works",
    relatedFiles: [],
    acceptanceCriteria: [],
    constraints: [],
  });
}

describe("execution repositories", () => {
  it("persists approval requests and decisions", () => {
    const db = openDatabase(":memory:");
    const task = createTask(db);
    const repo = new ApprovalRequestRepository(db);
    const record = repo.create({
      taskId: task.id,
      method: "item/commandExecution/requestApproval",
      payload: { command: "npm install" },
      riskLevel: "prompt",
    });

    repo.decide(record.id, "accept");
    const stored = repo.listByTask(task.id)[0];
    expect(stored.decision).toBe("accept");
    expect(stored.decidedAt).toBeTruthy();
  });

  it("persists validation results", () => {
    const db = openDatabase(":memory:");
    const task = createTask(db);
    const repo = new ValidationResultRepository(db);
    repo.save(task.id, {
      command: { id: "test", label: "test", command: ["npm", "test"], timeoutSec: 60 },
      cwd: "/tmp",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      status: "passed",
      stdout: "ok",
      stderr: "",
    });
    expect(repo.listByTask(task.id)).toHaveLength(1);
  });
});
