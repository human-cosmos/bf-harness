import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { WorkflowService } from "../src/services/workflow-service.js";

function createProjectAndTask(db: ReturnType<typeof openDatabase>) {
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
  return { tasks, taskId: task.id };
}

describe("WorkflowService", () => {
  it("approves a plan and enters implementation", () => {
    const db = openDatabase(":memory:");
    const { tasks, taskId } = createProjectAndTask(db);
    const workflow = new WorkflowService(tasks, db);

    tasks.updateStatus(taskId, "PREPARING_WORKSPACE");
    tasks.updateStatus(taskId, "ANALYZING");
    workflow.submitPlan(taskId, {
      problemSummary: "broken",
      rootCauseHypothesis: "bad code",
      evidence: ["log"],
      proposedFiles: ["src/a.ts"],
      fixStrategy: "fix",
      regressionTests: ["npm test"],
      validationCommands: ["npm test"],
      risks: [],
      openQuestions: [],
    });
    expect(tasks.get(taskId)?.status).toBe("WAITING_FOR_PLAN_APPROVAL");

    workflow.approvePlan(taskId, "ok");
    expect(tasks.get(taskId)?.status).toBe("IMPLEMENTING");
  });

  it("rejects a plan and returns to analysis", () => {
    const db = openDatabase(":memory:");
    const { tasks, taskId } = createProjectAndTask(db);
    const workflow = new WorkflowService(tasks, db);

    tasks.updateStatus(taskId, "PREPARING_WORKSPACE");
    tasks.updateStatus(taskId, "ANALYZING");
    workflow.submitPlan(taskId, {
      problemSummary: "broken",
      rootCauseHypothesis: "bad code",
      evidence: ["log"],
      proposedFiles: ["src/a.ts"],
      fixStrategy: "fix",
      regressionTests: ["npm test"],
      validationCommands: ["npm test"],
      risks: [],
      openQuestions: [],
    });
    workflow.rejectPlan(taskId, "need more evidence");
    expect(tasks.get(taskId)?.status).toBe("ANALYZING");
  });

  it("refuses approval before a plan is pending", () => {
    const db = openDatabase(":memory:");
    const { tasks, taskId } = createProjectAndTask(db);
    const workflow = new WorkflowService(tasks, db);

    tasks.updateStatus(taskId, "PREPARING_WORKSPACE");
    tasks.updateStatus(taskId, "ANALYZING");
    expect(() => workflow.approvePlan(taskId)).toThrow();
  });
});
