import {
  createBugfixTaskInputSchema,
  createProjectInputSchema,
  createTaskContract,
  type RepairPlan,
  type TaskStatus,
} from "@bugfix-harness/shared";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDatabase } from "../db.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { TaskRepository } from "../repositories/task-repository.js";
import { WorktreeRepository } from "../repositories/worktree-repository.js";
import { GitWorktreeManager } from "./worktree-manager.js";
import { WorkflowService } from "./workflow-service.js";
import { ExecutionService } from "./execution-service.js";
import { AgentSessionRepository } from "../repositories/agent-session-repository.js";
import { AgentEventRepository } from "../repositories/agent-event-repository.js";
import { AgentOrchestrator } from "./agent-orchestrator.js";
import { EventBus } from "./event-bus.js";
import {
  ClarificationCoordinator,
  type ClarificationAnswers,
} from "./clarification-coordinator.js";

const localCodexBin = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../codex-harness/codex-rs/target/debug/codex",
);

interface AnalysisRun {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  error?: string;
  plan?: RepairPlan;
}

function fallbackTaskTitle(description: string): string {
  const firstLine = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const normalized = (firstLine ?? "未命名 Bugfix 任务")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 80) || "未命名 Bugfix 任务";
}

export interface BugfixServiceOptions {
  db: AppDatabase;
  worktreeRoot: string;
  eventBus?: EventBus;
  codexBin?: string;
  analysisTimeoutMs?: number;
}

export class BugfixService {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly worktrees: WorktreeRepository;
  readonly worktreeManager: GitWorktreeManager;
  readonly workflow: WorkflowService;
  readonly execution: ExecutionService;
  readonly sessions: AgentSessionRepository;
  readonly agentEvents: AgentEventRepository;
  readonly agent: AgentOrchestrator;
  readonly events: EventBus;
  readonly clarifications: ClarificationCoordinator;
  private readonly worktreeRoot: string;
  private readonly codexBin: string;
  private readonly analysisTimeoutMs: number;
  private readonly analysisRuns = new Map<string, AnalysisRun>();

  constructor(options: BugfixServiceOptions) {
    this.events = options.eventBus ?? new EventBus();
    this.projects = new ProjectRepository(options.db);
    this.tasks = new TaskRepository(options.db);
    this.worktrees = new WorktreeRepository(options.db);
    this.worktreeManager = new GitWorktreeManager();
    this.worktreeRoot = options.worktreeRoot;
    this.codexBin =
      options.codexBin ??
      process.env.CODEX_BIN ??
      (existsSync(localCodexBin) ? localCodexBin : "codex-harness");
    this.analysisTimeoutMs =
      options.analysisTimeoutMs ??
      Number(process.env.BUGFIX_HARNESS_ANALYSIS_TIMEOUT_MS ?? 600_000);
    this.workflow = new WorkflowService(this.tasks, options.db);
    this.execution = new ExecutionService(
      options.db,
      this.projects,
      this.tasks,
      this.worktrees,
      this.workflow.plans,
    );
    this.clarifications = new ClarificationCoordinator(this.events);
    this.sessions = new AgentSessionRepository(options.db);
    this.agentEvents = new AgentEventRepository(options.db);
    this.agent = new AgentOrchestrator(
      this.tasks,
      this.projects,
      this.worktrees,
      this.workflow,
      this.execution,
      this.sessions,
      this.agentEvents,
      this.workflow.plans,
      this.codexBin,
      (taskId) => this.prepareWorktree(taskId),
      this.clarifications,
      this.analysisTimeoutMs,
    );
  }

  async createProject(input: unknown) {
    const parsed = createProjectInputSchema.parse(input);
    await this.worktreeManager.validateRepository(parsed.repoPath);
    if (this.projects.findByRepoPath(parsed.repoPath)) {
      throw new Error("A project already exists for this repository path");
    }
    const project = this.projects.create(parsed);
    this.events.publish({ type: "project.created", payload: project });
    return project;
  }

  async createTask(input: unknown) {
    const parsed = createBugfixTaskInputSchema.parse(input);
    const title = parsed.title.trim() || fallbackTaskTitle(parsed.bugDescription);
    const project = this.projects.get(parsed.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const task = this.tasks.create({ ...parsed, title });
    const contract = createTaskContract(task, project);
    this.tasks.saveContract(task.id, contract);
    this.events.publish({ type: "task.created", taskId: task.id, payload: task });
    return { task, contract };
  }

  startAnalyze(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const analyzableStatuses: TaskStatus[] = [
      "DRAFT",
      "PREPARING_WORKSPACE",
    ];
    if (!analyzableStatuses.includes(task.status)) {
      throw new Error(`Cannot start analysis from status ${task.status}`);
    }

    const existing = this.analysisRuns.get(taskId);
    if (existing?.status === "RUNNING") {
      return { status: "RUNNING" as const };
    }

    const run: AnalysisRun = { status: "RUNNING" };
    this.analysisRuns.set(taskId, run);

    void this.agent
      .analyze(taskId)
      .then((plan) => {
        run.status = "SUCCEEDED";
        run.plan = plan;
      })
      .catch((error) => {
        run.status = "FAILED";
        run.error = (error as Error).message;
      });

    return { status: "STARTED" as const };
  }

  getAnalysisRun(taskId: string) {
    return this.analysisRuns.get(taskId) ?? null;
  }

  async continueFix(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    if (task.status !== "VALIDATING") {
      throw new Error(`Expected task status VALIDATING, got ${task.status}`);
    }

    const failed = this.execution.validationResults
      .listByTask(taskId)
      .filter((row) => row.status === "failed" || row.status === "timeout");
    if (failed.length === 0) {
      throw new Error("No failed validation results to continue fixing");
    }

    const feedback = failed
      .map((row) => {
        let command = String(row.command ?? "");
        try {
          command = Array.isArray(JSON.parse(command))
            ? JSON.parse(command).join(" ")
            : command;
        } catch {
          // Keep the raw command text when it is not JSON.
        }
        return [
          `Command ${row.command_id}: ${command}`,
          `Status: ${row.status}`,
          `Exit code: ${row.exit_code ?? "n/a"}`,
          `stdout:\n${row.stdout ?? ""}`,
          `stderr:\n${row.stderr ?? ""}`,
        ].join("\n");
      })
      .join("\n\n");

    this.workflow.transitionTask(taskId, "IMPLEMENTING");
    return this.agent.implement(taskId, feedback);
  }

  async cancelTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    await this.agent.interruptTask(taskId);
    this.clarifications.clear(taskId);
    this.workflow.cancelTask(taskId);
    return { status: "CANCELLED" as const };
  }

  async deleteTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    await this.agent.interruptTask(taskId);
    this.clarifications.clear(taskId);
    this.analysisRuns.delete(taskId);

    const worktree = this.worktrees.getByTaskId(taskId);
    if (worktree) {
      const project = this.projects.get(task.projectId);
      if (project) {
        try {
          await this.worktreeManager.remove(project.repoPath, worktree.path);
        } catch (error) {
          console.warn(
            `Failed to remove worktree for task ${taskId}:`,
            (error as Error).message,
          );
        }
      }
    }

    const deleted = this.tasks.delete(taskId);
    if (!deleted) {
      throw new Error("Task not found");
    }
    return { deleted: true };
  }

  getClarification(taskId: string) {
    return this.clarifications.get(taskId);
  }

  answerClarification(taskId: string, answers: ClarificationAnswers) {
    return this.clarifications.answer(taskId, answers);
  }

  getAttention(taskId: string) {
    const clarification = this.clarifications.get(taskId);
    const planApproval = this.workflow.plans.getLatest(taskId);
    const pendingApprovals = this.execution.approvals
      .listByTask(taskId)
      .filter((approval) => !approval.decision).length;
    const validationRows = this.execution.validationResults.listByTask(taskId);
    const validation = {
      passed: validationRows.filter((row) => String(row.status) === "passed").length,
      failed: validationRows.filter((row) => String(row.status) === "failed").length,
      timeout: validationRows.filter((row) => String(row.status) === "timeout").length,
      skipped: validationRows.filter((row) => String(row.status) === "skipped").length,
    };

    return {
      taskId,
      clarification,
      planApproval: planApproval
        ? { status: planApproval.status }
        : null,
      pendingApprovals,
      validation,
    };
  }

  askPlanQuestion(taskId: string, question: string) {
    return this.agent.askPlanQuestion(taskId, question);
  }

  async prepareWorktree(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    const project = this.projects.get(task.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const result = await this.worktreeManager.create({
      taskId: task.id,
      repoPath: project.repoPath,
      root: this.worktreeRoot,
    });

    const worktree = this.worktrees.create({
      taskId: task.id,
      projectId: project.id,
      path: result.path,
      baseCommit: result.baseCommit,
      branch: result.branch,
    });
    this.worktrees.updateStatus(worktree.id, "READY");
    this.events.publish({
      type: "worktree.ready",
      taskId: task.id,
      payload: worktree,
    });
    return this.worktrees.getByTaskId(task.id)!;
  }
}
