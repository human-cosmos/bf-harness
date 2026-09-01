import type { TaskStatus } from "./domain.js";

export const taskStatuses: TaskStatus[] = [
  "DRAFT",
  "PREPARING_WORKSPACE",
  "ANALYZING",
  "WAITING_FOR_PLAN_APPROVAL",
  "IMPLEMENTING",
  "VALIDATING",
  "WAITING_FOR_ACCEPTANCE",
  "ACCEPTED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
];

const transitions: Record<TaskStatus, TaskStatus[]> = {
  DRAFT: ["PREPARING_WORKSPACE", "CANCELLED"],
  PREPARING_WORKSPACE: ["ANALYZING", "FAILED", "CANCELLED"],
  ANALYZING: [
    "WAITING_FOR_PLAN_APPROVAL",
    "BLOCKED",
    "FAILED",
    "CANCELLED",
  ],
  WAITING_FOR_PLAN_APPROVAL: [
    "ANALYZING",
    "IMPLEMENTING",
    "CANCELLED",
    "FAILED",
  ],
  IMPLEMENTING: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["IMPLEMENTING", "WAITING_FOR_ACCEPTANCE", "BLOCKED", "FAILED"],
  WAITING_FOR_ACCEPTANCE: [
    "IMPLEMENTING",
    "ACCEPTED",
    "REJECTED",
    "CANCELLED",
  ],
  ACCEPTED: [],
  BLOCKED: [
    "ANALYZING",
    "IMPLEMENTING",
    "VALIDATING",
    "WAITING_FOR_ACCEPTANCE",
    "CANCELLED",
  ],
  FAILED: ["ANALYZING"],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionTask(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
  return to;
}

export function isTerminal(status: TaskStatus): boolean {
  return transitions[status].length === 0;
}
