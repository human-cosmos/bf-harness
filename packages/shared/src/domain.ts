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

export interface ClarificationOption {
  label: string;
  description: string;
}

export interface ClarificationQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: ClarificationOption[] | null;
}

export interface PendingClarification {
  taskId: string;
  requestId: number;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  questions: ClarificationQuestion[];
  createdAt: string;
}

export interface TaskAttention {
  taskId: string;
  clarification: PendingClarification | null;
  planApproval: {
    status: "PENDING" | "APPROVED" | "REJECTED";
  } | null;
  pendingApprovals: number;
  validation: {
    passed: number;
    failed: number;
    timeout: number;
    skipped: number;
  };
}

export type ProjectSource = "local" | "remote";

export type RemoteHost = "github" | "gitlab";

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  source: ProjectSource;
  remoteUrl?: string | null;
  remoteHost?: RemoteHost | null;
  defaultBranch?: string | null;
  instructionSources: string[];
  validationCommands: ValidationCommand[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskContractScope {
  allowedPaths: string[];
  forbiddenPaths: string[];
}

export interface TaskContract {
  schemaVersion: "1.0";
  goal: string;
  observedBehavior: string;
  expectedBehavior: string;
  reproduction?: string;
  acceptanceCriteria: string[];
  constraints: string[];
  scope: TaskContractScope;
  validationCommands: ValidationCommand[];
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
  relatedFiles?: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Worktree {
  id: string;
  taskId: string;
  projectId: string;
  path: string;
  baseCommit: string;
  branch: string;
  status: "CREATING" | "READY" | "FAILED" | "CLEANING";
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface RemoteCloneProgress {
  phase: "preflight" | "cloning" | "validating" | "finalizing";
  percent: number | null;
  message: string;
}

export interface RemoteCloneJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  remoteUrl: string;
  targetDir: string;
  progress: RemoteCloneProgress;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  projectId?: string;
}
