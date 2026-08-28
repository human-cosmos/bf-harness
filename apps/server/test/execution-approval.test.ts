import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { WorktreeRepository } from "../src/repositories/worktree-repository.js";
import { PlanApprovalRepository } from "../src/repositories/plan-approval-repository.js";
import { ExecutionService } from "../src/services/execution-service.js";
import { EventBus } from "../src/services/event-bus.js";

function fixture(db: ReturnType<typeof openDatabase>) {
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const worktrees = new WorktreeRepository(db);
  const plans = new PlanApprovalRepository(db);
  const events = new EventBus();

  const project = projects.create({
    name: "demo",
    repoPath: "/tmp/demo",
    instructionSources: [],
    validationCommands: [],
    allowedPaths: ["/tmp/demo/src"],
    forbiddenPaths: ["/tmp/demo/secrets"],
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
    path: "/tmp/demo",
    baseCommit: "abc",
    branch: "bugfix/task",
  });
  worktrees.updateStatus(worktree.id, "READY");

  const execution = new ExecutionService(
    db,
    projects,
    tasks,
    worktrees,
    plans,
    events,
  );
  return { taskId: task.id, execution, events };
}

describe("ExecutionService approval decisions", () => {
  it("auto-allows read-only commands without creating a pending waiter", async () => {
    const db = openDatabase(":memory:");
    const { taskId, execution } = fixture(db);
    const result = await execution.requestApprovalDecision(taskId, {
      kind: "command",
      command: "git status",
      cwd: "/tmp/demo",
    });
    expect(result.decision).toBe("accept");
    const [approval] = execution.approvals.listByTask(taskId);
    expect(approval?.decision).toBe("accept");
    expect(approval?.method).toBe("command");
  });

  it("auto-denies permanently forbidden commands", async () => {
    const db = openDatabase(":memory:");
    const { taskId, execution } = fixture(db);
    const result = await execution.requestApprovalDecision(taskId, {
      kind: "command",
      command: "git push origin main",
      cwd: "/tmp/demo",
    });
    expect(result.decision).toBe("decline");
    expect(execution.approvals.listByTask(taskId)[0]?.decision).toBe("decline");
  });

  it("waits for the user decision on prompt-risk commands", async () => {
    const db = openDatabase(":memory:");
    const { taskId, execution } = fixture(db);
    const pending = execution.requestApprovalDecision(taskId, {
      kind: "command",
      command: "npm install lodash",
      cwd: "/tmp/demo",
    });

    const [approval] = execution.approvals.listByTask(taskId);
    expect(approval?.decision).toBeUndefined();

    execution.decideApproval(taskId, approval!.id, "accept");
    await expect(pending).resolves.toMatchObject({
      decision: "accept",
      approvalId: approval!.id,
    });
  });

  it("stores the friendly approval kind as method", async () => {
    const db = openDatabase(":memory:");
    const { taskId, execution } = fixture(db);
    const pending = execution.requestApprovalDecision(taskId, {
      kind: "command",
      command: "npm install lodash",
      cwd: "/tmp/demo",
    });
    const approval = execution.approvals.listByTask(taskId)[0];
    expect(approval?.method).toBe("command");
    execution.decideApproval(taskId, approval!.id, "accept");
    await pending;
  });

  it("resolves pending approvals as cancel when a task is cancelled", async () => {
    const db = openDatabase(":memory:");
    const { taskId, execution, events } = fixture(db);
    const emitted: Array<{ type: string; taskId?: string }> = [];
    events.subscribe((event) => {
      if (event.type === "approval.decided") {
        emitted.push(event);
      }
    });
    const pending = execution.requestApprovalDecision(taskId, {
      kind: "command",
      command: "npm install lodash",
      cwd: "/tmp/demo",
    });

    execution.cancelApprovals(taskId);
    await expect(pending).resolves.toMatchObject({ decision: "cancel" });
    expect(execution.approvals.listByTask(taskId)[0]?.decision).toBe("cancel");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.taskId).toBe(taskId);
  });
});
