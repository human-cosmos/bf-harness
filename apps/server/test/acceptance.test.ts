import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import {
  classifyApprovalRequest,
  makePolicyContext,
} from "../src/services/approval-policy.js";
import {
  nextValidationAction,
  MAX_AUTO_REPAIR_ROUNDS,
} from "../src/services/retry-policy.js";
import { WorkflowService } from "../src/services/workflow-service.js";

function createTaskFixture(db: ReturnType<typeof openDatabase>) {
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
  return { projects, tasks, taskId: task.id };
}

const plan = {
  problemSummary: "broken",
  rootCauseHypothesis: "bad code",
  evidence: ["log"],
  proposedFiles: ["src/a.ts"],
  fixStrategy: "fix",
  regressionTests: ["npm test"],
  validationCommands: ["npm test"],
  risks: [],
  openQuestions: [],
};

describe("AC acceptance coverage", () => {
  it("AC-002 plan rejection returns to analysis without implementation", () => {
    const db = openDatabase(":memory:");
    const { tasks, taskId } = createTaskFixture(db);
    const workflow = new WorkflowService(tasks, db);
    tasks.updateStatus(taskId, "PREPARING_WORKSPACE");
    tasks.updateStatus(taskId, "ANALYZING");
    workflow.submitPlan(taskId, plan);
    workflow.rejectPlan(taskId, "need more evidence");
    expect(tasks.get(taskId)?.status).toBe("ANALYZING");
    expect(workflow.plans.getLatest(taskId)?.status).toBe("REJECTED");
  });

  it("AC-003 high-risk commands require prompt or deny", () => {
    const context = makePolicyContext({
      worktreeRoot: "/tmp/worktree",
      allowedPaths: ["/tmp/worktree/src"],
      forbiddenPaths: ["/tmp/worktree/secrets"],
      plannedPaths: [],
      declaredValidationCommands: [],
    });
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "npm install lodash", cwd: "/tmp/worktree" },
        context,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "git push origin main", cwd: "/tmp/worktree" },
        context,
      ).level,
    ).toBe("deny");
  });

  it("AC-004 same validation failure blocks after two rounds", () => {
    expect(
      nextValidationAction({ currentRound: MAX_AUTO_REPAIR_ROUNDS, sameFailure: true }),
    ).toBe("BLOCKED");
  });

  it("AC-005 task records survive database reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-harness-ac005-"));
    const dbPath = join(root, "data.sqlite");
    try {
      const first = openDatabase(dbPath);
      const { taskId } = createTaskFixture(first);
      first.close();

      const second = openDatabase(dbPath);
      const tasks = new TaskRepository(second);
      expect(tasks.get(taskId)?.status).toBe("DRAFT");
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
