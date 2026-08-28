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
  hint: string;
  href: string;
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    key: "analyze",
    label: "分析",
    hint: "让 Codex 分析问题并生成修复计划",
    href: "plan",
  },
  {
    key: "plan",
    label: "计划确认",
    hint: "确认 Codex 提出的修复计划",
    href: "plan",
  },
  {
    key: "implement",
    label: "实施",
    hint: "让 Codex 修改代码并处理审批",
    href: "approvals",
  },
  {
    key: "validate",
    label: "验证",
    hint: "检查改动和自动验证结果",
    href: "diff",
  },
  {
    key: "accept",
    label: "验收",
    hint: "查看验收报告并做最终决定",
    href: "report",
  },
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
        href: `/tasks/${state.task.id}`,
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
        href: `/tasks/${state.task.id}/diff`,
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
