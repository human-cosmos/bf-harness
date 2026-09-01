import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SYSTEM_SETTINGS, type RepairPlan } from "@bugfix-harness/shared";
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

  it("counts only the latest validation outcome per command in attention", () => {
    const { db, service, worktreeRoot } = createService();
    try {
      const project = service.projects.create({
        name: "attention",
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

      const outcome = (
        status: "passed" | "failed" | "timeout",
        finishedAt: string,
      ) => ({
        command: {
          id: "test",
          label: "test",
          command: ["npm", "test"],
          timeoutSec: 60,
        },
        cwd: "/repo",
        startedAt: finishedAt,
        finishedAt,
        exitCode: status === "passed" ? 0 : 1,
        status,
        stdout: "",
        stderr: "",
      });

      service.execution.validationResults.save(
        task.id,
        outcome("failed", "2026-01-01T00:00:00.000Z"),
      );
      service.execution.validationResults.save(
        task.id,
        outcome("passed", "2026-01-02T00:00:00.000Z"),
      );

      const attention = service.getAttention(task.id);
      expect(attention.validation.failed).toBe(0);
      expect(attention.validation.timeout).toBe(0);
      expect(attention.validation.passed).toBe(1);
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("still surfaces the latest failed validation for a non-accepted task", () => {
    const { db, service, worktreeRoot } = createService();
    try {
      const project = service.projects.create({
        name: "attention-failed",
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

      service.execution.validationResults.save(task.id, {
        command: {
          id: "test",
          label: "test",
          command: ["npm", "test"],
          timeoutSec: 60,
        },
        cwd: "/repo",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:00.000Z",
        exitCode: 1,
        status: "timeout",
        stdout: "",
        stderr: "",
      });

      const attention = service.getAttention(task.id);
      expect(attention.validation.timeout).toBe(1);
      expect(attention.validation.failed).toBe(0);
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
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

  it("moves a blocked task back to validating when checks are re-run", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
      const project = service.projects.create({
        name: "blocked",
        repoPath: worktreeRoot,
        instructionSources: [],
        validationCommands: [
          {
            id: "echo",
            label: "echo",
            command: ["node", "-e", "console.log('ok')"],
            timeoutSec: 10,
          },
        ],
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
      new WorktreeRepository(db).create({
        taskId: task.id,
        projectId: project.id,
        path: worktreeRoot,
        baseCommit: "abc123",
        branch: `harness/${task.id}`,
      });
      service.tasks.updateStatus(task.id, "BLOCKED");
      const job = service.startValidationJob(task.id);
      expect(service.tasks.get(task.id)?.status).toBe("VALIDATING");
      await vi.waitUntil(() => service.getJob(job.id)?.status !== "running", {
        timeout: 5000,
      });
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("rejects updating a project to a non-git repo path", async () => {
    const { db, service, worktreeRoot } = createService();
    const badRepo = mkdtempSync(join(tmpdir(), "bugfix-service-not-git-"));
    try {
      const project = service.projects.create({
        name: "update-invalid",
        repoPath: "/tmp/demo",
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [],
        forbiddenPaths: [],
      });

      await expect(
        service.updateProject(project.id, { repoPath: badRepo }),
      ).rejects.toThrow("该目录不是 Git 仓库");
    } finally {
      rmSync(badRepo, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("rejects updating a project to another project's repo path", async () => {
    const { db, service, worktreeRoot } = createService();
    const repo = mkdtempSync(join(tmpdir(), "bugfix-service-repo-"));
    try {
      execFileSync("git", ["init", repo]);
      const first = service.projects.create({
        name: "first",
        repoPath: repo,
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [],
        forbiddenPaths: [],
      });
      const second = service.projects.create({
        name: "second",
        repoPath: "/tmp/demo",
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [],
        forbiddenPaths: [],
      });

      await expect(
        service.updateProject(second.id, { repoPath: repo }),
      ).rejects.toThrow("A project already exists for this repository path");
      expect(service.projects.get(first.id)?.repoPath).toBe(repo);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("leaves the task waiting for plan approval in manual mode", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
      service.systemSettings.save({
        ...DEFAULT_SYSTEM_SETTINGS,
        security: {
          ...DEFAULT_SYSTEM_SETTINGS.security,
          bugfixAutomationMode: "manual",
        },
      });
      const { taskId } = createAnalyzableTask(service);
      vi.spyOn(service.agent, "analyze").mockImplementation(async (id) => {
        const plan = samplePlan();
        service.workflow.submitPlan(id, plan);
        return plan;
      });
      const implement = vi.spyOn(service.agent, "implement");

      service.startAnalyze(taskId);
      await vi.waitUntil(
        () => service.getAnalysisRun(taskId)?.status === "SUCCEEDED",
      );

      expect(service.tasks.get(taskId)?.status).toBe("WAITING_FOR_PLAN_APPROVAL");
      expect(implement).not.toHaveBeenCalled();
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("allows re-running analysis after a failure", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
      const project = service.projects.create({
        name: "retry",
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
      service.tasks.updateStatus(task.id, "FAILED");
      service.systemSettings.save({
        ...DEFAULT_SYSTEM_SETTINGS,
        security: {
          ...DEFAULT_SYSTEM_SETTINGS.security,
          bugfixAutomationMode: "manual",
        },
      });
      vi.spyOn(service.agent, "analyze").mockImplementation(async (id) => {
        const plan = samplePlan();
        service.workflow.submitPlan(id, plan);
        return plan;
      });

      service.startAnalyze(task.id);
      await vi.waitUntil(
        () => service.getAnalysisRun(task.id)?.status === "SUCCEEDED",
      );
      expect(service.tasks.get(task.id)?.status).toBe(
        "WAITING_FOR_PLAN_APPROVAL",
      );
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("auto-runs implement, validation, and acceptance in auto mode", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
      service.systemSettings.save({
        ...DEFAULT_SYSTEM_SETTINGS,
        security: {
          ...DEFAULT_SYSTEM_SETTINGS.security,
          bugfixAutomationMode: "auto",
        },
      });
      const { taskId } = createAnalyzableTask(service);
      vi.spyOn(service.agent, "analyze").mockImplementation(async (id) => {
        const plan = samplePlan();
        service.workflow.submitPlan(id, plan);
        return plan;
      });
      vi.spyOn(service.agent, "implement").mockImplementation(async (id) => {
        service.workflow.transitionTask(id, "VALIDATING");
        return "done";
      });
      vi.spyOn(service.execution, "runValidations").mockImplementation(
        async (id) => {
          service.tasks.updateStatus(id, "WAITING_FOR_ACCEPTANCE");
          return [];
        },
      );
      vi.spyOn(service.execution, "buildReport").mockResolvedValue({} as never);

      service.startAnalyze(taskId);
      await vi.waitUntil(() => service.tasks.get(taskId)?.status === "ACCEPTED");
      expect(service.execution.runValidations).toHaveBeenCalledWith(taskId);
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("marks the task failed when automated implement throws", async () => {
    const { db, service, worktreeRoot } = createService();
    try {
      service.systemSettings.save({
        ...DEFAULT_SYSTEM_SETTINGS,
        security: {
          ...DEFAULT_SYSTEM_SETTINGS.security,
          bugfixAutomationMode: "auto",
        },
      });
      const { taskId } = createAnalyzableTask(service);
      vi.spyOn(service.agent, "analyze").mockImplementation(async (id) => {
        const plan = samplePlan();
        service.workflow.submitPlan(id, plan);
        return plan;
      });
      vi.spyOn(service.agent, "implement").mockRejectedValue(
        new Error("implement exploded"),
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        service.startAnalyze(taskId);
        await vi.waitUntil(() => service.tasks.get(taskId)?.status === "FAILED");
        expect(service.getAnalysisRun(taskId)?.status).toBe("SUCCEEDED");
      } finally {
        error.mockRestore();
      }
    } finally {
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });
});

function samplePlan(): RepairPlan {
  return {
    problemSummary: "bug",
    rootCauseHypothesis: "cause",
    evidence: ["log"],
    proposedFiles: ["src/app.ts"],
    fixStrategy: "fix it",
    regressionTests: ["npm test"],
    validationCommands: ["npm test"],
    risks: [],
    openQuestions: [],
  };
}

function createAnalyzableTask(service: BugfixService) {
  const project = service.projects.create({
    name: "auto",
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
  service.tasks.updateStatus(task.id, "ANALYZING");
  return { taskId: task.id };
}
