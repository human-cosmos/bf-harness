import type { PendingClarification, TaskAttention } from "@bugfix-harness/shared";

export type {
  ClarificationOption,
  ClarificationQuestion,
  PendingClarification,
  TaskAttention,
} from "@bugfix-harness/shared";

export type TaskStatus =
  | "DRAFT"
  | "PREPARING_WORKSPACE"
  | "ANALYZING"
  | "WAITING_FOR_PLAN_APPROVAL"
  | "IMPLEMENTING"
  | "VALIDATING"
  | "WAITING_FOR_ACCEPTANCE"
  | "ACCEPTED"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED"
  | "REJECTED";

export interface ValidationCommand {
  id: string;
  label: string;
  command: string[];
  timeoutSec: number;
  required?: boolean;
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  instructionSources: string[];
  validationCommands: ValidationCommand[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BugfixTask {
  id: string;
  projectId: string;
  title: string;
  bugDescription: string;
  observedBehavior: string;
  expectedBehavior: string;
  reproductionSteps?: string;
  reproductionCommand?: string;
  logs?: string;
  relatedFiles: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskContract {
  schemaVersion: "1.0";
  goal: string;
  observedBehavior: string;
  expectedBehavior: string;
  reproduction?: string;
  acceptanceCriteria: string[];
  constraints: string[];
  scope: { allowedPaths: string[]; forbiddenPaths: string[] };
  validationCommands: ValidationCommand[];
}

export interface TaskDetail {
  task: BugfixTask;
  contract?: TaskContract;
}

export interface DiffResult {
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "untracked" | "renamed";
  }>;
  unifiedDiff: string;
  stats: {
    total: number;
    added: number;
    modified: number;
    deleted: number;
    untracked: number;
    renamed: number;
  };
}

export interface ValidationOutcome {
  command: ValidationCommand;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  status: "passed" | "failed" | "timeout" | "skipped";
  stdout: string;
  stderr: string;
  skipReason?: string;
}

export interface DeliveryReport {
  id: string;
  taskId: string;
  createdAt: string;
  taskGoal: string;
  rootCause: string;
  evidence: string[];
  implementation: string;
  modifiedFiles: string[];
  acceptanceChecklist: Array<{ criterion: string; satisfied: boolean }>;
  validationResults: Array<{
    commandId: string;
    command: string[];
    status: string;
    exitCode: number | null;
  }>;
  knownRisks: string[];
  unverifiedItems: string[];
  recommendedReviewLocations: string[];
}

type RequestOptions = RequestInit & { timeoutMs?: number | null };

async function request<T>(url: string, init: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const { timeoutMs = 20_000, ...requestInit } = init;
  const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, {
    ...requestInit,
    headers,
    signal: controller.signal,
  });
  if (timeout) {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed: ${response.status}`);
  }
  return body as T;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (input: Omit<Project, "id" | "createdAt" | "updatedAt">) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  pickDirectory: () =>
    request<{ path: string | null; isGitRepo: boolean; repoName: string | null }>(
      "/api/fs/pick-directory",
      { method: "POST" },
    ),
  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  listTasks: (projectId?: string) =>
    request<BugfixTask[]>(`/api/tasks${projectId ? `?projectId=${projectId}` : ""}`),
  createTask: (input: Record<string, unknown>) =>
    request<{ task: BugfixTask; contract: TaskContract }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getTask: (id: string) => request<TaskDetail>(`/api/tasks/${id}`),
  prepareWorktree: (id: string) =>
    request(`/api/tasks/${id}/prepare-worktree`, { method: "POST" }),
  getPlan: (id: string) => request(`/api/tasks/${id}/plan`),
  askPlanQuestion: (id: string, question: string) =>
    request<{ answer: string }>(`/api/tasks/${id}/plan/question`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
  submitPlan: (id: string, plan: unknown) =>
    request(`/api/tasks/${id}/plan`, { method: "POST", body: JSON.stringify(plan) }),
  approvePlan: (id: string, comment?: string) =>
    request(`/api/tasks/${id}/plan/approve`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  rejectPlan: (id: string, comment?: string) =>
    request(`/api/tasks/${id}/plan/reject`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  cancelTask: (id: string) =>
    request(`/api/tasks/${id}/cancel`, { method: "POST" }),
  deleteTask: (id: string) =>
    request<{ deleted: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
  listApprovals: (id: string) => request<any[]>(`/api/tasks/${id}/approvals`),
  getDiff: (id: string) => request<DiffResult>(`/api/tasks/${id}/diff`),
  runValidations: (id: string) =>
    request<ValidationOutcome[]>(`/api/tasks/${id}/validate`, {
      method: "POST",
      timeoutMs: 0,
    }),
  listValidations: (id: string) =>
    request<ValidationOutcome[]>(`/api/tasks/${id}/validations`),
  continueFix: (id: string) =>
    request(`/api/tasks/${id}/continue-fix`, { method: "POST", timeoutMs: 0 }),
  buildReport: (id: string) =>
    request<DeliveryReport>(`/api/tasks/${id}/report`, {
      method: "POST",
      timeoutMs: 0,
    }),
  analyze: (id: string) => request(`/api/tasks/${id}/analyze`, { method: "POST" }),
  getAnalysis: (id: string) => request(`/api/tasks/${id}/analysis`),
  getClarification: (id: string) =>
    request<PendingClarification | null>(`/api/tasks/${id}/clarification`),
  getAttention: (id: string) =>
    request<TaskAttention>(`/api/tasks/${id}/attention`),
  answerClarification: (
    id: string,
    answers: Record<string, { answers: string[] }>,
  ) =>
    request<{ answered: boolean }>(`/api/tasks/${id}/clarification`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
  implement: (id: string) =>
    request(`/api/tasks/${id}/implement`, { method: "POST", timeoutMs: 0 }),
  acceptTask: (id: string) => request(`/api/tasks/${id}/accept`, { method: "POST" }),
  rejectTask: (id: string, comment?: string) =>
    request(`/api/tasks/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  returnTask: (id: string, comment?: string) =>
    request(`/api/tasks/${id}/return`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  decideApproval: (id: string, approvalId: string, decision: "accept" | "decline" | "cancel") =>
    request(`/api/tasks/${id}/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  listEvents: (id: string, limit = 100, afterSeq = 0) =>
    request<any[]>(`/api/tasks/${id}/events?limit=${limit}&afterSeq=${afterSeq}`),
  diagnostics: () => request<Record<string, unknown>>("/api/diagnostics"),
};
