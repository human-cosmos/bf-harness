import {
  canTransition,
  planSchema,
  type TaskStatus,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";
import { PlanApprovalRepository } from "../repositories/plan-approval-repository.js";
import { TaskRepository } from "../repositories/task-repository.js";

export class WorkflowService {
  readonly plans: PlanApprovalRepository;

  constructor(
    private readonly tasks: TaskRepository,
    db: AppDatabase,
    plans?: PlanApprovalRepository,
  ) {
    this.plans = plans ?? new PlanApprovalRepository(db);
  }

  submitPlan(taskId: string, input: unknown) {
    const task = this.requireTask(taskId);
    this.requireStatus(task, "ANALYZING");
    const plan = planSchema.parse(input);
    const approval = this.plans.create(taskId, plan);
    this.tasks.updateStatus(taskId, "WAITING_FOR_PLAN_APPROVAL");
    return approval;
  }

  approvePlan(taskId: string, comment?: string) {
    const task = this.requireTask(taskId);
    this.requireStatus(task, "WAITING_FOR_PLAN_APPROVAL");
    const approval = this.requirePendingApproval(taskId);
    this.plans.decide(approval.id, "APPROVED", comment);
    this.tasks.updateStatus(taskId, "IMPLEMENTING");
    return { approvalId: approval.id };
  }

  rejectPlan(taskId: string, comment?: string) {
    const task = this.requireTask(taskId);
    this.requireStatus(task, "WAITING_FOR_PLAN_APPROVAL");
    const approval = this.requirePendingApproval(taskId);
    this.plans.decide(approval.id, "REJECTED", comment);
    this.tasks.updateStatus(taskId, "ANALYZING");
    return { approvalId: approval.id };
  }

  cancelTask(taskId: string) {
    const task = this.requireTask(taskId);
    this.requireTransition(task.status, "CANCELLED");
    this.tasks.updateStatus(taskId, "CANCELLED");
  }

  acceptTask(taskId: string) {
    const task = this.requireTask(taskId);
    this.requireStatus(task, "WAITING_FOR_ACCEPTANCE");
    this.tasks.updateStatus(taskId, "ACCEPTED");
    return this.tasks.get(taskId)!;
  }

  rejectTask(taskId: string, comment?: string) {
    const task = this.requireTask(taskId);
    this.requireStatus(task, "WAITING_FOR_ACCEPTANCE");
    this.tasks.updateStatus(taskId, "REJECTED");
    return { task: this.tasks.get(taskId)!, comment };
  }

  returnTaskForRework(taskId: string, comment?: string) {
    const task = this.requireTask(taskId);
    this.requireStatus(task, "WAITING_FOR_ACCEPTANCE");
    this.tasks.updateStatus(taskId, "IMPLEMENTING");
    return { task: this.tasks.get(taskId)!, comment };
  }

  transitionTask(taskId: string, next: TaskStatus) {
    const task = this.requireTask(taskId);
    this.requireTransition(task.status, next);
    this.tasks.updateStatus(taskId, next);
    return this.tasks.get(taskId)!;
  }

  private requireTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return task;
  }

  private requireStatus(task: { status: TaskStatus }, status: TaskStatus) {
    if (task.status !== status) {
      throw new Error(`Expected task status ${status}, got ${task.status}`);
    }
  }

  private requireTransition(from: TaskStatus, to: TaskStatus) {
    if (!canTransition(from, to)) {
      throw new Error(`Invalid task transition: ${from} -> ${to}`);
    }
  }

  private requirePendingApproval(taskId: string) {
    const approval = this.plans.getLatest(taskId);
    if (!approval || approval.status !== "PENDING") {
      throw new Error("No pending plan approval");
    }
    return approval;
  }
}
