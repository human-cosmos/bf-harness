import { z } from "zod";

export const CONVERSATION_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export const CONVERSATION_APPROVAL_POLICIES = [
  "on-request",
  "never",
  "untrusted",
  "granular",
] as const;

export const CONVERSATION_APPROVAL_REVIEWERS = [
  "user",
  "auto_review",
  "guardian_subagent",
] as const;

export const CONVERSATION_STATUSES = [
  "IDLE",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_CLARIFICATION",
  "FAILED",
  "ARCHIVED",
] as const;

export const CONVERSATION_TURN_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "INTERRUPTED",
  "CANCELLED",
] as const;

export type ConversationSandboxMode =
  (typeof CONVERSATION_SANDBOX_MODES)[number];
export type ConversationApprovalPolicy =
  (typeof CONVERSATION_APPROVAL_POLICIES)[number];
export type ConversationApprovalsReviewer =
  (typeof CONVERSATION_APPROVAL_REVIEWERS)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type ConversationTurnStatus =
  (typeof CONVERSATION_TURN_STATUSES)[number];

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

export interface ConversationTurn {
  id: string;
  conversationId: string;
  codexTurnId: string;
  status: ConversationTurnStatus;
  model?: string;
  effort?: string;
  error?: unknown;
  startedAtMs?: number;
  completedAtMs?: number;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

export const CONVERSATION_ITEM_TYPES = [
  "agentMessage",
  "userMessage",
  "reasoning",
  "plan",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageGeneration",
  "contextCompaction",
  "warning",
  "error",
  "approval",
  "clarification",
  "tokenUsage",
] as const;

export type ConversationItemType =
  (typeof CONVERSATION_ITEM_TYPES)[number];

export interface ConversationItem {
  id: string;
  conversationId: string;
  codexTurnId: string | null;
  codexItemId: string | null;
  parentItemId: string | null;
  itemType: ConversationItemType;
  role: string | null;
  author: string | null;
  title: string | null;
  status: string | null;
  payload: unknown;
  seq: number;
  createdAtMs: number | null;
  completedAtMs: number | null;
  createdAt: string;
}

export const CONVERSATION_EVENT_KINDS = [
  "user.message",
  "agent.message.delta",
  "agent.message.completed",
  "reasoning.summary.delta",
  "reasoning.text.delta",
  "plan.delta",
  "command.started",
  "command.output.delta",
  "command.completed",
  "fileChange.patchUpdated",
  "mcpTool.progress",
  "mcpTool.completed",
  "dynamicTool.completed",
  "webSearch.updated",
  "imageGeneration.updated",
  "tokenUsage.updated",
  "compaction.started",
  "warning",
  "error",
  "approval.requested",
  "approval.resolved",
  "clarification.requested",
  "clarification.answered",
  "turn.started",
  "turn.completed",
  "raw",
] as const;

export type ConversationEventKind =
  (typeof CONVERSATION_EVENT_KINDS)[number];

export interface ConversationEvent {
  id?: number;
  conversationId: string;
  codexThreadId: string | null;
  codexTurnId: string | null;
  codexItemId: string | null;
  kind: ConversationEventKind;
  method: string;
  payload: unknown;
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
  payload: unknown;
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
  questions: unknown;
  answers: unknown | null;
  status: "PENDING" | "ANSWERED" | "CANCELLED";
  createdAt: string;
  answeredAt: string | null;
}

export const DEFAULT_CONVERSATION_POLICY: ConversationPolicy = {
  sandboxMode: "workspace-write",
  networkAccess: false,
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  allowGitWrites: false,
};

export const DEFAULT_CONVERSATION_SETTINGS: ConversationSettings = {
  model: undefined,
  reasoningEffort: undefined,
  baseInstructions: undefined,
  developerInstructions: undefined,
};

export const conversationPolicySchema = z.object({
  sandboxMode: z.enum(CONVERSATION_SANDBOX_MODES),
  networkAccess: z.boolean(),
  approvalPolicy: z.enum(CONVERSATION_APPROVAL_POLICIES),
  approvalsReviewer: z.enum(CONVERSATION_APPROVAL_REVIEWERS),
  allowGitWrites: z.boolean(),
});

export const conversationSettingsSchema = z.object({
  model: z.string().trim().max(200).optional(),
  reasoningEffort: z.string().trim().max(50).optional(),
  baseInstructions: z.string().max(100_000).optional(),
  developerInstructions: z.string().max(100_000).optional(),
});

export const createConversationInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().max(120).default(""),
  policy: conversationPolicySchema.default(DEFAULT_CONVERSATION_POLICY),
  settings: conversationSettingsSchema.default(DEFAULT_CONVERSATION_SETTINGS),
});

export const updateConversationInputSchema = z.object({
  title: z.string().trim().max(120).optional(),
  policy: conversationPolicySchema.optional(),
  settings: conversationSettingsSchema.optional(),
});

export const conversationMentionSchema = z.object({
  name: z.string().min(1).max(500),
  path: z.string().min(1).max(4096),
});

export const sendConversationMessageSchema = z.object({
  text: z.string().max(200_000).default(""),
  mentions: z.array(conversationMentionSchema).max(200).default([]),
  quickCommand: z.string().trim().max(100).optional(),
});

export type CreateConversationInput = z.infer<
  typeof createConversationInputSchema
>;
export type UpdateConversationInput = z.infer<
  typeof updateConversationInputSchema
>;
export type SendConversationMessageInput = z.infer<
  typeof sendConversationMessageSchema
>;

export function fallbackConversationTitle(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const normalized = (firstLine ?? "未命名对话")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 120) || "未命名对话";
}

export function isFullAccessConversationPolicy(
  policy: ConversationPolicy,
): boolean {
  return (
    policy.sandboxMode === "danger-full-access" &&
    policy.networkAccess === true &&
    policy.allowGitWrites === true
  );
}
