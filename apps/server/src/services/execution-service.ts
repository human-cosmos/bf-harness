import type { AppDatabase } from "../db.js";
import { ApprovalRequestRepository } from "../repositories/approval-request-repository.js";
import { DeliveryReportRepository } from "../repositories/delivery-report-repository.js";
import { PlanApprovalRepository } from "../repositories/plan-approval-repository.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { TaskRepository } from "../repositories/task-repository.js";
import { ValidationResultRepository } from "../repositories/validation-result-repository.js";
import { WorktreeRepository } from "../repositories/worktree-repository.js";
import {
  classifyApprovalRequest,
  makePolicyContext,
  type ApprovalRequest,
  type RiskLevel,
} from "./approval-policy.js";
import { DeliveryReportService } from "./delivery-report-service.js";
import { DiffService } from "./diff-service.js";
import { ValidationRunner } from "./validation-runner.js";

export class ExecutionService {
  readonly approvals: ApprovalRequestRepository;
  readonly validationResults: ValidationResultRepository;
  readonly reports: DeliveryReportRepository;
  readonly diffService: DiffService;
  readonly validationRunner: ValidationRunner;
  readonly reportService: DeliveryReportService;
  private readonly approvalWaiters = new Map<
    string,
    (decision: "accept" | "decline" | "cancel") => void
  >();

  constructor(
    private readonly db: AppDatabase,
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly worktrees: WorktreeRepository,
    private readonly plans: PlanApprovalRepository,
  ) {
    this.approvals = new ApprovalRequestRepository(db);
    this.validationResults = new ValidationResultRepository(db);
    this.reports = new DeliveryReportRepository(db);
    this.diffService = new DiffService();
    this.validationRunner = new ValidationRunner();
    this.reportService = new DeliveryReportService();
  }

  private requireTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return task;
  }

  private requireWorktree(taskId: string) {
    const worktree = this.worktrees.getByTaskId(taskId);
    if (!worktree || worktree.status !== "READY") {
      throw new Error("Worktree not ready");
    }
    return worktree;
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    return project;
  }

  async recordApproval(taskId: string, request: ApprovalRequest) {
    const task = this.requireTask(taskId);
    const worktree = this.requireWorktree(taskId);
    const project = this.requireProject(task.projectId);
    const plan = this.plans.getLatest(taskId);

    const decision = classifyApprovalRequest(
      request,
      makePolicyContext({
        worktreeRoot: worktree.path,
        allowedPaths: project.allowedPaths,
        forbiddenPaths: project.forbiddenPaths,
        plannedPaths: plan?.status === "APPROVED" ? plan.content.proposedFiles : [],
        declaredValidationCommands: project.validationCommands.map(
          (command) => ({ command: command.command }),
        ),
      }),
    );

    return this.approvals.create({
      taskId,
      method: request.kind,
      payload: request,
      riskLevel: decision.level,
    });
  }

  async requestApprovalDecision(
    taskId: string,
    request: ApprovalRequest,
    codexRequestId?: number,
  ): Promise<{ decision: "accept" | "decline" | "cancel"; approvalId: string }> {
    const task = this.requireTask(taskId);
    const worktree = this.requireWorktree(taskId);
    const project = this.requireProject(task.projectId);
    const plan = this.plans.getLatest(taskId);

    const decision = classifyApprovalRequest(
      request,
      makePolicyContext({
        worktreeRoot: worktree.path,
        allowedPaths: project.allowedPaths,
        forbiddenPaths: project.forbiddenPaths,
        plannedPaths: plan?.status === "APPROVED" ? plan.content.proposedFiles : [],
        declaredValidationCommands: project.validationCommands.map(
          (command) => ({ command: command.command }),
        ),
      }),
    );

    const approval = this.approvals.create({
      taskId,
      codexRequestId,
      method:
        request.kind === "command"
          ? "item/commandExecution/requestApproval"
          : request.kind === "file"
            ? "item/fileChange/requestApproval"
            : request.kind === "network"
              ? "item/network/requestApproval"
              : "item/permissions/requestApproval",
      payload: request,
      riskLevel: decision.level,
    });

    if (decision.level === "autoAllow") {
      this.approvals.decide(approval.id, "accept");
      return { decision: "accept", approvalId: approval.id };
    }

    if (decision.level === "deny") {
      this.approvals.decide(approval.id, "decline");
      return { decision: "decline", approvalId: approval.id };
    }

    return new Promise((resolve) => {
      this.approvalWaiters.set(approval.id, (resolvedDecision) => {
        resolve({ decision: resolvedDecision, approvalId: approval.id });
      });
    });
  }

  decideApproval(
    taskId: string,
    approvalId: string,
    decision: "accept" | "decline" | "cancel",
  ) {
    this.requireTask(taskId);
    this.approvals.decide(approvalId, decision);
    const waiter = this.approvalWaiters.get(approvalId);
    if (waiter) {
      this.approvalWaiters.delete(approvalId);
      waiter(decision);
    }
    return { approvalId, decision };
  }

  decideApprovals(
    taskId: string,
    approvalIds: string[],
    decision: "accept" | "decline" | "cancel",
  ) {
    this.requireTask(taskId);
    const decided = [];
    for (const approvalId of approvalIds) {
      this.approvals.decide(approvalId, decision);
      const waiter = this.approvalWaiters.get(approvalId);
      if (waiter) {
        this.approvalWaiters.delete(approvalId);
        waiter(decision);
      }
      decided.push({ approvalId, decision });
    }
    return { decided };
  }

  async generateDiff(taskId: string) {
    const worktree = this.requireWorktree(taskId);
    return this.diffService.generate(worktree.path);
  }

  async runValidations(taskId: string) {
    const task = this.requireTask(taskId);
    const worktree = this.requireWorktree(taskId);
    const project = this.requireProject(task.projectId);
    const outcomes = [];

    for (const command of project.validationCommands) {
      const outcome = await this.validationRunner.run(command, worktree.path);
      this.validationResults.save(taskId, outcome);
      outcomes.push(outcome);
    }

    const allPassed =
      outcomes.length > 0 &&
      outcomes.every((outcome) => outcome.status === "passed");
    if (allPassed && task.status === "VALIDATING") {
      this.tasks.updateStatus(taskId, "WAITING_FOR_ACCEPTANCE");
    }

    return outcomes;
  }

  listValidations(taskId: string) {
    return this.validationResults
      .listByTask(taskId)
      .map((row) => this.mapStoredOutcome(row));
  }

  async buildReport(taskId: string) {
    const task = this.requireTask(taskId);
    const contract = this.tasks.getContract(taskId);
    if (!contract) {
      throw new Error("Task contract not found");
    }
    const planApproval = this.plans.getLatest(taskId);
    if (!planApproval || planApproval.status !== "APPROVED") {
      throw new Error("No approved repair plan");
    }
    const diff = await this.generateDiff(taskId);
    let validationRows = this.validationResults.listByTask(taskId);
    let outcomes = validationRows.map((row) => this.mapStoredOutcome(row));

    if (outcomes.length === 0) {
      outcomes = await this.runValidations(taskId);
    }

    const report = this.reportService.build({
      task,
      contract,
      plan: planApproval.content,
      diff,
      validationResults: outcomes,
    });
    this.reports.save(report);
    return report;
  }

  private mapStoredOutcome(
    row: Record<string, unknown>,
  ): Awaited<ReturnType<ValidationRunner["run"]>> {
    return {
      command: {
        id: String(row.command_id),
        label: String(row.command_id),
        command: JSON.parse(String(row.command)),
        timeoutSec: 0,
      },
      cwd: String(row.cwd),
      startedAt: String(row.started_at),
      finishedAt: String(row.finished_at),
      exitCode: row.exit_code === null ? null : Number(row.exit_code),
      status: String(row.status) as
        | "passed"
        | "failed"
        | "timeout"
        | "skipped",
      stdout: String(row.stdout),
      stderr: String(row.stderr),
      skipReason: row.skip_reason ? String(row.skip_reason) : undefined,
    };
  }
}
