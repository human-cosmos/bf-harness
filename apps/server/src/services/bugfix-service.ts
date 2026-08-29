import {
  createBugfixTaskInputSchema,
  createProjectInputSchema,
  createTaskContract,
  MAX_PROMPT_TEMPLATE_LENGTH,
  PROMPT_TEMPLATE_KEYS,
  type PromptTemplateKey,
  type RepairPlan,
  type TaskStatus,
  type Worktree,
  unknownPromptTemplatePlaceholders,
} from "@bugfix-harness/shared";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { TaskRepository } from "../repositories/task-repository.js";
import { PromptTemplateRepository } from "../repositories/prompt-template-repository.js";
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
import { ConversationService } from "./conversation-service.js";
import {
  groupFailedValidationRuns,
  nextValidationAction,
  validationFailureSignature,
} from "./retry-policy.js";
import { classifyHarnessEvent } from "./task-log-classifier.js";

const localCodexBin = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../codex-harness/codex-rs/target/debug/codex",
);

interface AnalysisRun {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  error?: string;
  plan?: RepairPlan;
}

export type BackgroundJobKind =
  | "implement"
  | "continue-fix"
  | "validate"
  | "report";

export interface BackgroundJob {
  id: string;
  taskId: string;
  kind: BackgroundJobKind;
  status: "running" | "succeeded" | "failed";
  message: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
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
  implementationTimeoutMs?: number;
  analysisMaxTimeoutMs?: number | null;
  implementationMaxTimeoutMs?: number | null;
}

export class BugfixService {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly worktrees: WorktreeRepository;
  readonly worktreeManager: GitWorktreeManager;
  readonly workflow: WorkflowService;
  readonly execution: ExecutionService;
  readonly promptTemplates: PromptTemplateRepository;
  readonly sessions: AgentSessionRepository;
  readonly agentEvents: AgentEventRepository;
  readonly agent: AgentOrchestrator;
  readonly events: EventBus;
  readonly clarifications: ClarificationCoordinator;
  readonly conversationService: ConversationService;
  private readonly worktreeRoot: string;
  private readonly codexBin: string;
  private readonly analysisTimeoutMs: number;
  private readonly implementationTimeoutMs: number;
  private readonly analysisMaxTimeoutMs: number | null;
  private readonly implementationMaxTimeoutMs: number | null;
  private readonly analysisRuns = new Map<string, AnalysisRun>();
  private readonly backgroundJobs = new Map<string, BackgroundJob>();
  private readonly activeJobs = new Set<string>();

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
    this.implementationTimeoutMs =
      options.implementationTimeoutMs ??
      Number(process.env.BUGFIX_HARNESS_IMPLEMENTATION_TIMEOUT_MS ?? 600_000);
    this.analysisMaxTimeoutMs =
      options.analysisMaxTimeoutMs ??
      this.readOptionalPositiveNumber(
        process.env.BUGFIX_HARNESS_ANALYSIS_MAX_DURATION_MS,
      );
    this.implementationMaxTimeoutMs =
      options.implementationMaxTimeoutMs ??
      this.readOptionalPositiveNumber(
        process.env.BUGFIX_HARNESS_IMPLEMENTATION_MAX_DURATION_MS,
      );
    this.workflow = new WorkflowService(
      this.tasks,
      options.db,
      undefined,
      this.events,
    );
    this.promptTemplates = new PromptTemplateRepository(options.db);
    this.execution = new ExecutionService(
      options.db,
      this.projects,
      this.tasks,
      this.worktrees,
      this.workflow.plans,
      this.events,
    );
    this.clarifications = new ClarificationCoordinator(this.events);
    this.conversationService = new ConversationService({
      db: options.db,
      projects: this.projects,
      eventBus: this.events,
      codexBin: this.codexBin,
    });
    this.sessions = new AgentSessionRepository(options.db);
    this.agentEvents = new AgentEventRepository(options.db);
    this.events.subscribe((event) => {
      if (!event.taskId || !this.tasks.get(event.taskId)) {
        return;
      }
      try {
        const classification = classifyHarnessEvent(event.type, event.payload);
        this.agentEvents.append({
          taskId: event.taskId,
          method: event.type,
          payload: event.payload,
          emittedAtMs: Date.now(),
          level: classification.level,
          source: classification.source,
          phase: classification.phase,
          message: classification.message,
        });
      } catch (error) {
        console.warn(
          `Failed to persist task log for ${event.taskId}:`,
          (error as Error).message,
        );
      }
    });
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
      this.promptTemplates,
      (taskId) => this.prepareWorktree(taskId),
      this.clarifications,
      this.analysisTimeoutMs,
      this.implementationTimeoutMs,
      this.analysisMaxTimeoutMs,
      this.implementationMaxTimeoutMs,
    );
  }

  private readOptionalPositiveNumber(value: string | undefined): number | null {
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

  async deleteProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const taskList = this.tasks.list(projectId);
    for (const task of taskList) {
      await this.agent.interruptTask(task.id);
      this.clarifications.clear(task.id);
      this.execution.cancelApprovals(task.id);
      this.analysisRuns.delete(task.id);
      this.clearTaskJobs(task.id);

      const worktree = this.worktrees.getByTaskId(task.id);
      if (worktree) {
        try {
          await this.worktreeManager.remove(project.repoPath, worktree.path);
        } catch (error) {
          console.warn(
            `Failed to remove worktree for task ${task.id}:`,
            (error as Error).message,
          );
        }
      }
    }

    for (const task of taskList) {
      this.tasks.delete(task.id);
    }

    if (!this.projects.delete(projectId)) {
      throw new Error("Project not found");
    }

    this.events.publish({ type: "project.deleted", payload: { projectId } });
    return { deleted: true };
  }

  listPromptTemplates() {
    return this.promptTemplates.list();
  }

  savePromptTemplates(
    templates: Partial<Record<PromptTemplateKey, string>>,
  ) {
    const entries = Object.entries(templates) as Array<
      [PromptTemplateKey, string]
    >;
    for (const [key, value] of entries) {
      if (!PROMPT_TEMPLATE_KEYS.includes(key)) {
        throw new Error(`Unknown prompt template key: ${key}`);
      }
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Prompt template ${key} must be a non-empty string`);
      }
      if (value.length > MAX_PROMPT_TEMPLATE_LENGTH) {
        throw new Error(
          `Prompt template ${key} exceeds the ${MAX_PROMPT_TEMPLATE_LENGTH} character limit`,
        );
      }
      const unknownPlaceholders = unknownPromptTemplatePlaceholders(value, key);
      if (unknownPlaceholders.length > 0) {
        throw new Error(
          `Prompt template ${key} contains unknown placeholders: ${unknownPlaceholders.join(", ")}`,
        );
      }
    }

    for (const [key, value] of entries) {
      this.promptTemplates.save(key, value);
    }
    return this.promptTemplates.list();
  }

  resetPromptTemplates(key?: PromptTemplateKey) {
    if (key && !PROMPT_TEMPLATE_KEYS.includes(key)) {
      throw new Error(`Unknown prompt template key: ${key}`);
    }
    return this.promptTemplates.reset(key);
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
      "ANALYZING",
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

    const failedRuns = groupFailedValidationRuns(
      this.execution.validationResults.listByTask(taskId),
    );
    const currentRound = failedRuns.length;
    const sameFailure =
      failedRuns.length >= 2 &&
      validationFailureSignature(failedRuns.at(-1)!.failures) ===
        validationFailureSignature(failedRuns.at(-2)!.failures);
    const validationAction = nextValidationAction({
      currentRound,
      sameFailure,
    });
    if (validationAction === "BLOCKED") {
      this.workflow.transitionTask(taskId, "BLOCKED");
      throw new Error(
        "Same validation failure reached the automatic repair limit. Task is blocked for manual review.",
      );
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
    this.execution.cancelApprovals(taskId);
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
    this.execution.cancelApprovals(taskId);
    this.analysisRuns.delete(taskId);
    this.clearTaskJobs(taskId);

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
    this.events.publish({ type: "task.deleted", taskId, payload: { taskId } });
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

  async getWorkflowState(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const project = this.projects.get(task.projectId);
    const contract = this.tasks.getContract(taskId);
    const worktree = this.worktrees.getByTaskId(taskId);
    const planApproval = this.workflow.plans.getLatest(taskId);
    const report = this.execution.reports.getByTask(taskId);
    const pendingApprovals = this.execution.approvals
      .listByTask(taskId)
      .filter((approval) => !approval.decision);

    let validations: Awaited<ReturnType<typeof this.execution.listValidations>>;
    try {
      validations = this.execution.listValidations(taskId);
    } catch {
      validations = [];
    }

    let diff: Awaited<ReturnType<typeof this.execution.generateDiff>> | null = null;
    try {
      diff = await this.execution.generateDiff(taskId);
    } catch {
      diff = null;
    }

    return {
      task,
      project: project
        ? {
            id: project.id,
            name: project.name,
            repoPath: project.repoPath,
          }
        : null,
      contract,
      worktree: worktree
        ? {
            id: worktree.id,
            path: worktree.path,
            baseCommit: worktree.baseCommit,
            branch: worktree.branch,
            status: worktree.status,
          }
        : null,
      attention: this.getAttention(taskId),
      planApproval,
      pendingApprovals,
      validations,
      report,
      diff,
      jobs: this.getTaskJobs(taskId),
    };
  }

  startBackgroundJob(
    taskId: string,
    kind: BackgroundJobKind,
    message: string,
    run: () => Promise<unknown>,
  ): BackgroundJob {
    const activeKey = `${taskId}:${kind}`;
    if (this.activeJobs.has(activeKey)) {
      throw new Error(`A ${kind} job is already running for this task`);
    }
    this.activeJobs.add(activeKey);

    const job: BackgroundJob = {
      id: randomUUID(),
      taskId,
      kind,
      status: "running",
      message,
      startedAt: new Date().toISOString(),
    };
    this.backgroundJobs.set(job.id, job);

    void run()
      .then(() => {
        job.status = "succeeded";
        job.message = `${message}完成`;
        job.finishedAt = new Date().toISOString();
        this.backgroundJobs.set(job.id, { ...job });
        this.events.publish({
          type: "job.completed",
          taskId,
          payload: { job },
        });
      })
      .catch((error) => {
        job.status = "failed";
        job.message = `${message}失败`;
        job.finishedAt = new Date().toISOString();
        job.error = (error as Error).message;
        this.backgroundJobs.set(job.id, { ...job });
        this.events.publish({
          type: "job.failed",
          taskId,
          payload: { job },
        });
      })
      .finally(() => {
        this.activeJobs.delete(activeKey);
      });

    this.events.publish({
      type: "job.started",
      taskId,
      payload: { job },
    });
    return job;
  }

  getJob(jobId: string) {
    return this.backgroundJobs.get(jobId) ?? null;
  }

  getTaskJobs(taskId: string) {
    return [...this.backgroundJobs.values()]
      .filter((job) => job.taskId === taskId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  private clearTaskJobs(taskId: string): void {
    for (const [jobId, job] of this.backgroundJobs) {
      if (job.taskId === taskId) {
        this.backgroundJobs.delete(jobId);
      }
    }
  }

  startImplementJob(taskId: string) {
    return this.startBackgroundJob(taskId, "implement", "开始实施", () =>
      this.agent.implement(taskId),
    );
  }

  startContinueFixJob(taskId: string) {
    return this.startBackgroundJob(taskId, "continue-fix", "继续修复", () =>
      this.continueFix(taskId),
    );
  }

  startValidationJob(taskId: string) {
    return this.startBackgroundJob(taskId, "validate", "运行检查", () =>
      this.execution.runValidations(taskId),
    );
  }

  startReportJob(taskId: string) {
    return this.startBackgroundJob(taskId, "report", "生成验收报告", () =>
      this.execution.buildReport(taskId),
    );
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

    const existing = this.worktrees.getByTaskId(taskId);
    if (existing && existsSync(existing.path)) {
      if (existing.status !== "READY") {
        this.worktrees.updateStatus(existing.id, "READY");
      }
      return this.worktrees.getByTaskId(taskId)!;
    }

    const result = await this.worktreeManager.create({
      taskId: task.id,
      repoPath: project.repoPath,
      root: this.worktreeRoot,
    });

    let worktree: Worktree;
    if (existing) {
      // The directory was gone, so recreate against the stored record: refresh
      // its location/base commit and report it as ready (same as a fresh one).
      this.worktrees.updateLocation(existing.id, {
        path: result.path,
        baseCommit: result.baseCommit,
        branch: result.branch,
      });
      this.worktrees.updateStatus(existing.id, "READY");
      worktree = this.worktrees.getByTaskId(task.id)!;
    } else {
      worktree = this.worktrees.create({
        taskId: task.id,
        projectId: project.id,
        path: result.path,
        baseCommit: result.baseCommit,
        branch: result.branch,
      });
      this.worktrees.updateStatus(worktree.id, "READY");
    }

    this.events.publish({
      type: "worktree.ready",
      taskId: task.id,
      payload: worktree,
    });
    return worktree;
  }
}
