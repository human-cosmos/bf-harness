import type {
  PendingClarification,
  PromptTemplateKey,
  TaskAttention,
} from "@bugfix-harness/shared";

export type {
  ClarificationOption,
  ClarificationQuestion,
  PendingClarification,
  PromptTemplateKey,
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

export interface ProjectSummary extends Project {
  taskCount: number;
  pendingTaskCount: number;
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

export interface ApprovalRequestItem {
  id: string;
  taskId: string;
  method: string;
  payload: unknown;
  riskLevel: string;
  decision?: "accept" | "decline" | "cancel";
  decidedAt?: string;
  createdAt: string;
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
  acceptanceChecklist: Array<{ criterion: string }>;
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

export interface WorkflowProject {
  id: string;
  name: string;
  repoPath: string;
}

export interface WorkflowWorktree {
  id: string;
  path: string;
  baseCommit: string;
  branch: string;
  status: "CREATING" | "READY" | "FAILED" | "CLEANING";
}

export interface BackgroundJob {
  id: string;
  taskId: string;
  kind: "implement" | "continue-fix" | "validate" | "report";
  status: "running" | "succeeded" | "failed";
  message: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface WorkflowState {
  task: BugfixTask;
  project: WorkflowProject | null;
  contract?: TaskContract;
  worktree: WorkflowWorktree | null;
  attention: TaskAttention;
  planApproval: {
    id: string;
    taskId: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    content?: Record<string, unknown>;
    createdAt: string;
    decidedAt?: string;
  } | null;
  pendingApprovals: ApprovalRequestItem[];
  validations: ValidationOutcome[];
  report: DeliveryReport | null;
  diff: DiffResult | null;
  jobs: BackgroundJob[];
}

export type TaskLogLevel = "debug" | "info" | "warn" | "error";
export type TaskLogSource =
  | "runtime"
  | "workflow"
  | "validation"
  | "approval"
  | "server";
export type TaskLogPhase =
  | "prepare"
  | "analyze"
  | "plan"
  | "implement"
  | "validate"
  | "report"
  | "lifecycle";

export interface TaskLogEntry {
  id: number;
  taskId: string;
  seq: number;
  level: TaskLogLevel;
  source: TaskLogSource;
  phase: TaskLogPhase;
  method: string;
  message: string;
  payload: unknown;
  codexThreadId: string | null;
  codexTurnId: string | null;
  codexItemId: string | null;
  emittedAtMs: number | null;
  createdAt: string;
}

export interface TaskLogsResponse {
  items: TaskLogEntry[];
  nextAfterSeq: number | null;
}

export interface PromptTemplateSetting {
  key: PromptTemplateKey;
  label: string;
  description: string;
  placeholders: string[];
  template: string;
  defaultTemplate: string;
}

export type ConversationSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";
export type ConversationApprovalPolicy =
  | "on-request"
  | "never"
  | "untrusted"
  | "granular";
export type ConversationApprovalsReviewer =
  | "user"
  | "auto_review"
  | "guardian_subagent";
export type ConversationStatus =
  | "IDLE"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "WAITING_CLARIFICATION"
  | "FAILED"
  | "ARCHIVED";

export interface ConversationPolicy {
  sandboxMode: ConversationSandboxMode;
  networkAccess: boolean;
  approvalPolicy: ConversationApprovalPolicy;
  approvalsReviewer: ConversationApprovalsReviewer;
  allowGitWrites: boolean;
}

export interface ConversationSettings {
  model?: string;
  reasoningEffort?: string;
  baseInstructions?: string;
  developerInstructions?: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  codexThreadId: string | null;
  status: ConversationStatus;
  policy: ConversationPolicy;
  settings: ConversationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationItem {
  id: string;
  conversationId: string;
  codexTurnId: string | null;
  codexItemId: string | null;
  parentItemId: string | null;
  itemType: string;
  role: string | null;
  author: string | null;
  title: string | null;
  status: string | null;
  payload: Record<string, unknown>;
  seq: number;
  createdAtMs: number | null;
  completedAtMs: number | null;
  createdAt: string;
}

export interface ConversationEvent {
  id?: number;
  conversationId: string;
  codexThreadId: string | null;
  codexTurnId: string | null;
  codexItemId: string | null;
  kind: string;
  method: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  seq: number;
  emittedAtMs: number | null;
  createdAt: string;
}

export interface ConversationApproval {
  id: string;
  conversationId: string;
  codexTurnId: string | null;
  codexItemId: string | null;
  codexRequestId: number | null;
  method: string;
  kind: string;
  payload: Record<string, unknown>;
  riskLevel: string;
  decision: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface ConversationClarification {
  id: string;
  conversationId: string;
  codexRequestId: number | null;
  codexTurnId: string | null;
  codexItemId: string | null;
  questions: Array<Record<string, unknown>>;
  answers: unknown;
  status: "PENDING" | "ANSWERED" | "CANCELLED";
  createdAt: string;
  answeredAt: string | null;
}

export interface ConversationTurn {
  id: string;
  conversationId: string;
  codexTurnId: string;
  status: string;
  model?: string;
  effort?: string;
  error?: unknown;
  startedAtMs?: number;
  completedAtMs?: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
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
  listProjectSummaries: () =>
    request<ProjectSummary[]>("/api/projects/summary"),
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
  listTaskAttentionSummaries: (projectId: string) =>
    request<Record<string, TaskAttention>>(
      `/api/tasks/attention-summary?projectId=${projectId}`,
    ),
  createTask: (input: Record<string, unknown>) =>
    request<{ task: BugfixTask; contract: TaskContract }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getTask: (id: string) => request<TaskDetail>(`/api/tasks/${id}`),
  getWorkflowState: (id: string) =>
    request<WorkflowState>(`/api/tasks/${id}/workflow-state`),
  getJob: (id: string, jobId: string) =>
    request<BackgroundJob>(`/api/tasks/${id}/jobs/${jobId}`),
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
  listApprovals: (id: string) =>
    request<ApprovalRequestItem[]>(`/api/tasks/${id}/approvals`),
  getDiff: (id: string) => request<DiffResult>(`/api/tasks/${id}/diff`),
  runValidations: (id: string) =>
    request<{ jobId: string; job: BackgroundJob }>(`/api/tasks/${id}/validate`, {
      method: "POST",
    }),
  listValidations: (id: string) =>
    request<ValidationOutcome[]>(`/api/tasks/${id}/validations`),
  continueFix: (id: string) =>
    request<{ jobId: string; job: BackgroundJob }>(`/api/tasks/${id}/continue-fix`, {
      method: "POST",
    }),
  getReport: (id: string) => request<DeliveryReport>(`/api/tasks/${id}/report`),
  buildReport: (id: string) =>
    request<{ jobId: string; job: BackgroundJob }>(`/api/tasks/${id}/report`, {
      method: "POST",
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
    request<{ jobId: string; job: BackgroundJob }>(`/api/tasks/${id}/implement`, {
      method: "POST",
    }),
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
  decideApprovals: (
    id: string,
    approvalIds: string[],
    decision: "accept" | "decline" | "cancel",
  ) =>
    request(`/api/tasks/${id}/approvals/decision-batch`, {
      method: "POST",
      body: JSON.stringify({ decision, approvalIds }),
    }),
  listEvents: (id: string, limit = 100, afterSeq = 0) =>
    request<any[]>(`/api/tasks/${id}/events?limit=${limit}&afterSeq=${afterSeq}`),
  listTaskLogs: (
    id: string,
    options: {
      afterSeq?: number;
      limit?: number;
      level?: TaskLogLevel;
      source?: TaskLogSource;
      phase?: TaskLogPhase;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (options.afterSeq) search.set("afterSeq", String(options.afterSeq));
    if (options.limit) search.set("limit", String(options.limit));
    if (options.level) search.set("level", options.level);
    if (options.source) search.set("source", options.source);
    if (options.phase) search.set("phase", options.phase);
    const query = search.toString();
    return request<TaskLogsResponse>(
      `/api/tasks/${id}/logs${query ? `?${query}` : ""}`,
    );
  },
  diagnostics: () => request<Record<string, unknown>>("/api/diagnostics"),
  getPromptTemplates: () =>
    request<PromptTemplateSetting[]>("/api/settings/prompts"),
  savePromptTemplates: (
    templates: Partial<Record<PromptTemplateKey, string>>,
  ) =>
    request<PromptTemplateSetting[]>("/api/settings/prompts", {
      method: "PUT",
      body: JSON.stringify({ templates }),
    }),
  resetPromptTemplates: (key?: PromptTemplateKey) =>
    request<PromptTemplateSetting[]>("/api/settings/prompts/reset", {
      method: "POST",
      body: JSON.stringify(key ? { key } : {}),
    }),
  listConversations: (projectId: string) =>
    request<Conversation[]>(`/api/projects/${projectId}/conversations`),
  createConversation: (
    projectId: string,
    input: Record<string, unknown>,
  ) =>
    request<Conversation>(`/api/projects/${projectId}/conversations`, {
      method: "POST",
      body: JSON.stringify({ ...input, projectId }),
    }),
  getConversation: (id: string) =>
    request<Conversation>(`/api/conversations/${id}`),
  updateConversation: (id: string, input: Record<string, unknown>) =>
    request<Conversation>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteConversation: (id: string) =>
    request<{ deleted: boolean }>(`/api/conversations/${id}`, {
      method: "DELETE",
    }),
  sendConversationMessage: (id: string, input: Record<string, unknown>) =>
    request<{ turnId: string }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: null,
    }),
  steerConversation: (id: string, input: Record<string, unknown>) =>
    request(`/api/conversations/${id}/steer`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  interruptConversation: (id: string) =>
    request<{ interrupted: boolean }>(`/api/conversations/${id}/interrupt`, {
      method: "POST",
    }),
  forkConversation: (id: string, lastTurnId?: string | null) =>
    request<Conversation>(`/api/conversations/${id}/fork`, {
      method: "POST",
      body: JSON.stringify({ lastTurnId }),
    }),
  compactConversation: (id: string) =>
    request(`/api/conversations/${id}/compact`, { method: "POST" }),
  archiveConversation: (id: string) =>
    request<Conversation>(`/api/conversations/${id}/archive`, {
      method: "POST",
    }),
  renameConversation: (id: string, title: string) =>
    request<Conversation>(`/api/conversations/${id}/name`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  listConversationTurns: (id: string, limit = 200, offset = 0) =>
    request<ConversationTurn[]>(
      `/api/conversations/${id}/turns?limit=${limit}&offset=${offset}`,
    ),
  listConversationTurnItems: (
    id: string,
    turnId: string,
    afterSeq = 0,
    limit = 500,
  ) =>
    request<ConversationItem[]>(
      `/api/conversations/${id}/turns/${turnId}/items?afterSeq=${afterSeq}&limit=${limit}`,
    ),
  listConversationEvents: (id: string, afterSeq = 0, limit = 1000) =>
    request<ConversationEvent[]>(
      `/api/conversations/${id}/events?afterSeq=${afterSeq}&limit=${limit}`,
    ),
  listConversationItems: (id: string, afterSeq = 0, limit = 1000) =>
    request<ConversationItem[]>(
      `/api/conversations/${id}/items?afterSeq=${afterSeq}&limit=${limit}`,
    ),
  syncConversation: (id: string) =>
    request<{ turns: number; items: number }>(`/api/conversations/${id}/sync`, {
      method: "POST",
    }),
  listConversationModels: (id: string) =>
    request<unknown>(`/api/conversations/${id}/models`),
  listConversationApprovals: (id: string) =>
    request<ConversationApproval[]>(`/api/conversations/${id}/approvals`),
  decideConversationApproval: (
    id: string,
    approvalId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) =>
    request<{ decided: boolean }>(
      `/api/conversations/${id}/approvals/${approvalId}/decision`,
      {
        method: "POST",
        body: JSON.stringify({ decision }),
      },
    ),
  getConversationClarification: (id: string) =>
    request<ConversationClarification | null>(
      `/api/conversations/${id}/clarification`,
    ),
  answerConversationClarification: (
    id: string,
    clarificationId: string,
    answers: Record<string, { answers: string[] }>,
  ) =>
    request<{ answered: boolean }>(`/api/conversations/${id}/clarification`, {
      method: "POST",
      body: JSON.stringify({ clarificationId, answers }),
    }),
  searchProjectFiles: (projectId: string, query: string) =>
    request<{
      contentItems: Array<{ type: string; text: string }>;
      success: boolean;
    }>(
      `/api/projects/${projectId}/fs/search?query=${encodeURIComponent(query)}`,
    ),
};
