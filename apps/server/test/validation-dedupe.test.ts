import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { WorktreeRepository } from "../src/repositories/worktree-repository.js";
import { PlanApprovalRepository } from "../src/repositories/plan-approval-repository.js";
import { ExecutionService } from "../src/services/execution-service.js";

describe("ExecutionService.runValidations", () => {
  it("deduplicates concurrent validation runs for the same task", async () => {
    const db = openDatabase(":memory:");
    const cwd = mkdtempSync(join(tmpdir(), "bugfix-validation-dedupe-"));
    try {
      const projects = new ProjectRepository(db);
      const tasks = new TaskRepository(db);
      const worktrees = new WorktreeRepository(db);
      const plans = new PlanApprovalRepository(db);

      const project = projects.create({
        name: "demo",
        repoPath: cwd,
        instructionSources: [],
        validationCommands: [
          {
            id: "slow",
            label: "slow",
            command: ["node", "-e", "setTimeout(()=>{},150)"],
            timeoutSec: 1,
          },
        ],
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
      const worktree = worktrees.create({
        taskId: task.id,
        projectId: project.id,
        path: cwd,
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
      );

      const [first, second] = await Promise.all([
        execution.runValidations(task.id),
        execution.runValidations(task.id),
      ]);

      expect(first).toBe(second);
      expect(execution.validationResults.listByTask(task.id)).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      db.close();
    }
  });
});
