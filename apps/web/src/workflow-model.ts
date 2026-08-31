import type { TaskStatus, WorkflowState } from "./api.js";

export type StepKey =
  | "analyze"
  | "plan"
  | "implement"
  | "validate"
  | "accept";

export const STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "neutral" | "active" | "success" | "warning" | "danger" }
> = {
  DRAFT: { label: "待开始", tone: "neutral" },
  PREPARING_WORKSPACE: { label: "准备仓库中", tone: "active" },
  ANALYZING: { label: "分析中", tone: "active" },
  WAITING_FOR_PLAN_APPROVAL: { label: "待你确认计划", tone: "warning" },
  IMPLEMENTING: { label: "待实施", tone: "active" },
  VALIDATING: { label: "验证中", tone: "active" },
  WAITING_FOR_ACCEPTANCE: { label: "待你验收", tone: "warning" },
  ACCEPTED: { label: "已验收", tone: "success" },
  BLOCKED: { label: "受阻", tone: "danger" },
  FAILED: { label: "失败", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  REJECTED: { label: "已拒绝", tone: "danger" },
};

export interface WorkflowStep {
  key: StepKey;
  label: string;
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { key: "analyze", label: "分析" },
  { key: "plan", label: "计划确认" },
  { key: "implement", label: "实施" },
  { key: "validate", label: "验证" },
  { key: "accept", label: "验收" },
];

const statusStep: Record<TaskStatus, StepKey | null> = {
  DRAFT: "analyze",
  PREPARING_WORKSPACE: "analyze",
  ANALYZING: "analyze",
  WAITING_FOR_PLAN_APPROVAL: "plan",
  IMPLEMENTING: "implement",
  VALIDATING: "validate",
  WAITING_FOR_ACCEPTANCE: "accept",
  ACCEPTED: null,
  BLOCKED: null,
  FAILED: null,
  CANCELLED: null,
  REJECTED: null,
};

export function currentStepForStatus(status: TaskStatus): StepKey | null {
  return statusStep[status] ?? null;
}

export function stepIndexForStatus(status: TaskStatus): number {
  const current = currentStepForStatus(status);
  if (!current) return -1;
  return WORKFLOW_STEPS.findIndex((step) => step.key === current);
}

export type StepVisualState =
  | "todo"
  | "done"
  | "working"
  | "awaiting"
  | "ready"
  | "failed";

export interface StepperStepView {
  key: StepKey;
  label: string;
  state: StepVisualState;
  current: boolean;
}

export type StepperTone =
  | "neutral"
  | "active"
  | "warning"
  | "danger"
  | "success";

export interface StepperView {
  steps: StepperStepView[];
  caption: string;
  tone: StepperTone;
  progress: number;
}

type JobKind = "implement" | "continue-fix" | "validate" | "report";

function runningJobKind(state: WorkflowState): JobKind | null {
  return (
    state.jobs.find((job) => job.status === "running")?.kind ?? null
  );
}

function failedJobKind(state: WorkflowState): JobKind | null {
  return (
    state.jobs.find((job) => job.status === "failed")?.kind ?? null
  );
}

function failedStepForState(state: WorkflowState): StepKey {
  const kind = failedJobKind(state);
  if (kind === "implement" || kind === "continue-fix") return "implement";
  if (kind === "validate") return "validate";
  if (kind === "report") return "accept";
  const hasFailedValidation =
    state.attention.validation.failed + state.attention.validation.timeout > 0;
  if (hasFailedValidation) return "validate";
  // Prepare/analyze failures are not tracked as background jobs.
  return "analyze";
}

function stepProgress(index: number): number {
  return WORKFLOW_STEPS.length > 1
    ? index / (WORKFLOW_STEPS.length - 1)
    : 0;
}

/**
 * Derives the visual state of the workflow stepper from the task status,
 * running/failed jobs, and validation attention. The intent is to make the
 * machine vs. human distinction explicit: "working" spins, "awaiting" nudges.
 */
export function stepperForState(state: WorkflowState): StepperView {
  const status = state.task.status;
  const runningKind = runningJobKind(state);
  const failedValidations =
    state.attention.validation.failed + state.attention.validation.timeout;

  if (status === "ACCEPTED") {
    return {
      steps: WORKFLOW_STEPS.map((step) => ({
        key: step.key,
        label: step.label,
        state: "done",
        current: false,
      })),
      caption: "已验收 · 全部阶段完成",
      tone: "success",
      progress: 1,
    };
  }

  if (status === "FAILED" || status === "BLOCKED") {
    const failedKey = failedStepForState(state);
    const failedIndex = WORKFLOW_STEPS.findIndex(
      (step) => step.key === failedKey,
    );
    return {
      steps: WORKFLOW_STEPS.map((step, index) => {
        if (index < failedIndex) {
          return { key: step.key, label: step.label, state: "done", current: false };
        }
        if (index === failedIndex) {
          return { key: step.key, label: step.label, state: "failed", current: true };
        }
        return { key: step.key, label: step.label, state: "todo", current: false };
      }),
      caption: status === "BLOCKED" ? "已受阻 · 停在当前阶段" : "已失败 · 停在当前阶段",
      tone: "danger",
      progress: stepProgress(failedIndex),
    };
  }

  if (status === "CANCELLED" || status === "REJECTED") {
    const rejected = status === "REJECTED";
    return {
      steps: WORKFLOW_STEPS.map((step, index) => {
        if (rejected && index < WORKFLOW_STEPS.length - 1) {
          return { key: step.key, label: step.label, state: "done", current: false };
        }
        if (rejected && index === WORKFLOW_STEPS.length - 1) {
          return { key: step.key, label: step.label, state: "failed", current: true };
        }
        return { key: step.key, label: step.label, state: "todo", current: false };
      }),
      caption: rejected ? "已拒绝 · 未通过验收" : "已取消 · 任务未完成",
      tone: rejected ? "danger" : "neutral",
      progress: rejected ? stepProgress(WORKFLOW_STEPS.length - 2) : 0,
    };
  }

  const currentIndex = stepIndexForStatus(status);
  const index = currentIndex >= 0 ? currentIndex : 0;

  let mode: StepVisualState = "ready";
  if (status === "PREPARING_WORKSPACE" || status === "ANALYZING") {
    mode = "working";
  } else if (
    status === "WAITING_FOR_PLAN_APPROVAL" ||
    status === "WAITING_FOR_ACCEPTANCE"
  ) {
    mode = "awaiting";
  } else if (status === "IMPLEMENTING") {
    mode =
      runningKind === "implement" || runningKind === "continue-fix"
        ? "working"
        : "ready";
  } else if (status === "VALIDATING") {
    mode =
      runningKind === "validate" || failedValidations === 0
        ? "working"
        : "awaiting";
  }

  const steps = WORKFLOW_STEPS.map((step, stepIndex) => {
    if (stepIndex < index) {
      return { key: step.key, label: step.label, state: "done" as const, current: false };
    }
    if (stepIndex > index) {
      return { key: step.key, label: step.label, state: "todo" as const, current: false };
    }
    return { key: step.key, label: step.label, state: mode, current: true };
  });

  const currentLabel = WORKFLOW_STEPS[index]?.label ?? "";
  let caption = "待开始";
  let tone: StepperTone = "neutral";

  if (mode === "working") {
    caption = `执行中 · ${currentLabel}`;
    tone = "active";
  } else if (mode === "awaiting") {
    caption =
      status === "VALIDATING"
        ? `检查未通过 · 等待你继续修复`
        : `等待你 · ${currentLabel}`;
    tone = "warning";
  } else if (mode === "ready") {
    caption =
      status === "IMPLEMENTING"
        ? `待实施 · ${currentLabel}`
        : `待开始 · ${currentLabel}`;
    tone = "neutral";
  }

  return {
    steps,
    caption,
    tone,
    progress: stepProgress(index),
  };
}

export interface EffectiveStatus {
  label: string;
  tone: "neutral" | "active" | "success" | "warning" | "danger";
}

/**
 * Resolves the human-facing status badge, overriding IMPLEMENTING while an
 * implement/continue-fix job is actually running so it reads "实施中" instead
 * of the misleading "待实施".
 */
export function effectiveStatusForState(state: WorkflowState): EffectiveStatus {
  const meta = STATUS_META[state.task.status];
  const runningKind = runningJobKind(state);

  if (
    state.task.status === "IMPLEMENTING" &&
    (runningKind === "implement" || runningKind === "continue-fix")
  ) {
    return {
      label: runningKind === "continue-fix" ? "继续修复中" : "实施中",
      tone: "active",
    };
  }

  return { label: meta.label, tone: meta.tone };
}

export type NextActionKey =
  | "start-analyze"
  | "submit-clarification"
  | "approve-plan"
  | "reject-plan"
  | "start-implement"
  | "handle-approvals"
  | "continue-fix"
  | "build-report"
  | "accept-task"
  | "rework-task"
  | "reject-task"
  | "none";

export interface NextAction {
  key: NextActionKey;
  label: string;
  description: string;
  href: string;
  primary: boolean;
}

export function nextActionForState(state: WorkflowState): NextAction {
  const status = state.task.status;
  const attention = state.attention;
  const failedValidations = state.validations.filter(
    (item) => item.status === "failed" || item.status === "timeout",
  );

  if (status === "DRAFT" || status === "PREPARING_WORKSPACE") {
    return {
      key: "start-analyze",
      label: "开始修复",
      description: "Codex 将创建独立工作区并开始分析问题。",
      href: `/tasks/${state.task.id}`,
      primary: true,
    };
  }

  if (status === "ANALYZING") {
    if (attention.clarification) {
      return {
        key: "submit-clarification",
        label: "补充分析信息",
        description: "Codex 需要你补充信息后继续分析。",
        href: `/tasks/${state.task.id}#clarification`,
        primary: true,
      };
    }
    return {
      key: "none",
      label: "分析进行中",
      description: "Codex 正在分析问题，请稍候。",
      href: `/tasks/${state.task.id}`,
      primary: false,
    };
  }

  if (status === "WAITING_FOR_PLAN_APPROVAL") {
    return {
      key: "approve-plan",
      label: "查看并批准计划",
      description: "批准后即可让 Codex 开始实施。",
      href: `/tasks/${state.task.id}/plan`,
      primary: true,
    };
  }

  if (status === "IMPLEMENTING") {
    if (attention.pendingApprovals > 0) {
      return {
        key: "handle-approvals",
        label: `处理 ${attention.pendingApprovals} 项操作审批`,
        description: "Codex 正在等待你审批操作。",
        href: `/tasks/${state.task.id}/approvals`,
        primary: true,
      };
    }
    return {
      key: "start-implement",
      label: "开始实施",
      description: "计划已批准，可以让 Codex 开始修改代码。",
      href: `/tasks/${state.task.id}`,
      primary: true,
    };
  }

  if (status === "VALIDATING") {
    if (failedValidations.length > 0) {
      return {
        key: "continue-fix",
        label: "根据失败结果继续修复",
        description: "有检查未通过，Codex 可以带着失败信息继续修改。",
        href: `/tasks/${state.task.id}/diff#validation-action`,
        primary: true,
      };
    }
    return {
      key: "none",
      label: "验证进行中",
      description: "代码修改已完成，正在运行自动检查。",
      href: `/tasks/${state.task.id}/diff`,
      primary: false,
    };
  }

  if (status === "WAITING_FOR_ACCEPTANCE") {
    return {
      key: "build-report",
      label: "查看并验收修复结果",
      description: "自动检查已通过，请生成报告并做最终决定。",
      href: `/tasks/${state.task.id}/report`,
      primary: true,
    };
  }

  if (status === "ACCEPTED") {
    return {
      key: "none",
      label: "修复已完成",
      description: "该任务已通过验收。",
      href: `/tasks/${state.task.id}`,
      primary: false,
    };
  }

  if (status === "BLOCKED") {
    return {
      key: "none",
      label: "任务受阻",
      description: "请查看任务详情和实时事件了解原因。",
      href: `/tasks/${state.task.id}`,
      primary: false,
    };
  }

  if (status === "FAILED" || status === "REJECTED" || status === "CANCELLED") {
    return {
      key: "none",
      label: "任务已结束",
      description: "当前状态无法继续自动推进。",
      href: `/tasks/${state.task.id}`,
      primary: false,
    };
  }

  return {
    key: "none",
    label: "查看任务",
    description: "请查看任务详情。",
    href: `/tasks/${state.task.id}`,
    primary: false,
  };
}

export function isActiveStatus(status: TaskStatus): boolean {
  return [
    "PREPARING_WORKSPACE",
    "ANALYZING",
    "WAITING_FOR_PLAN_APPROVAL",
    "IMPLEMENTING",
    "VALIDATING",
    "WAITING_FOR_ACCEPTANCE",
    "BLOCKED",
  ].includes(status);
}

export type TaskSectionKey =
  | "detail"
  | "plan"
  | "approvals"
  | "diff"
  | "report"
  | "logs";

export interface TaskSection {
  key: TaskSectionKey;
  label: string;
  path: string;
}

export const TASK_SECTIONS: TaskSection[] = [
  { key: "detail", label: "详情", path: "" },
  { key: "plan", label: "修复计划", path: "/plan" },
  { key: "approvals", label: "操作审批", path: "/approvals" },
  { key: "diff", label: "变更与检查", path: "/diff" },
  { key: "report", label: "验收报告", path: "/report" },
  { key: "logs", label: "运行日志", path: "/logs" },
];

export function sectionAttention(
  state: WorkflowState,
): Partial<Record<TaskSectionKey, number>> {
  const badges: Partial<Record<TaskSectionKey, number>> = {};
  if (state.attention.clarification) badges.detail = 1;
  if (state.attention.planApproval?.status === "PENDING") badges.plan = 1;
  if (state.attention.pendingApprovals > 0) {
    badges.approvals = state.attention.pendingApprovals;
  }
  const failed =
    state.attention.validation.failed + state.attention.validation.timeout;
  if (failed > 0) badges.diff = failed;
  if (state.task.status === "WAITING_FOR_ACCEPTANCE") badges.report = 1;
  return badges;
}
