import { z } from "zod";
import {
  conversationPolicySchema,
  DEFAULT_CONVERSATION_POLICY,
  type ConversationApprovalPolicy,
  type ConversationApprovalsReviewer,
  type ConversationPolicy,
} from "./conversation.js";
import {
  validationCommandSchema,
} from "./schemas.js";
import type { ValidationCommand } from "./domain.js";

export interface AgentSystemSettings {
  analysisIdleTimeoutMs: number;
  implementationIdleTimeoutMs: number;
  analysisMaxDurationMs: number | null;
  implementationMaxDurationMs: number | null;
  conversationIdleTimeoutMs: number;
  approvalTtlMs: number | null;
}

export interface ModelSystemSettings {
  bugfixModel?: string;
  bugfixReasoningEffort?: string;
  conversationModel?: string;
  conversationReasoningEffort?: string;
}

export interface SecuritySystemSettings {
  conversationDefaults: ConversationPolicy;
  bugfixAutomationMode: BugfixAutomationMode;
  analyzeApprovalPolicy: ConversationApprovalPolicy;
  analyzeApprovalsReviewer: ConversationApprovalsReviewer;
  implementApprovalPolicy: ConversationApprovalPolicy;
  implementApprovalsReviewer: ConversationApprovalsReviewer;
}

export type BugfixAutomationMode = "manual" | "auto";

export interface ProjectDefaultsSystemSettings {
  instructionSources: string[];
  validationCommands: ValidationCommand[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  newValidationCommand: ValidationCommand;
}

export interface StorageSystemSettings {
  totalDataLimitBytes: number;
  diskWarnRatio: number;
  taskLogLimitBytes: number;
  maxEventsPerTask: number;
  autoRepairRounds: number;
}

export interface RemoteSystemSettings {
  lsRemoteTimeoutMs: number;
  cloneTimeoutMs: number;
}

export interface RuntimeSystemSettings {
  codexBin?: string;
}

export interface SystemSettings {
  agent: AgentSystemSettings;
  models: ModelSystemSettings;
  security: SecuritySystemSettings;
  projectDefaults: ProjectDefaultsSystemSettings;
  storage: StorageSystemSettings;
  remote: RemoteSystemSettings;
  runtime: RuntimeSystemSettings;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  agent: {
    analysisIdleTimeoutMs: 600_000,
    implementationIdleTimeoutMs: 600_000,
    analysisMaxDurationMs: null,
    implementationMaxDurationMs: null,
    conversationIdleTimeoutMs: 600_000,
    approvalTtlMs: null,
  },
  models: {
    bugfixModel: undefined,
    bugfixReasoningEffort: undefined,
    conversationModel: undefined,
    conversationReasoningEffort: undefined,
  },
  security: {
    conversationDefaults: { ...DEFAULT_CONVERSATION_POLICY },
    bugfixAutomationMode: "manual",
    analyzeApprovalPolicy: "on-request",
    analyzeApprovalsReviewer: "user",
    implementApprovalPolicy: "on-request",
    implementApprovalsReviewer: "user",
  },
  projectDefaults: {
    instructionSources: ["AGENTS.md"],
    validationCommands: [],
    allowedPaths: ["src/", "test/"],
    forbiddenPaths: ["node_modules/"],
    newValidationCommand: {
      id: "check",
      label: "检查命令",
      command: ["npm", "run", "check"],
      timeoutSec: 300,
    },
  },
  storage: {
    totalDataLimitBytes: 5 * 1024 * 1024 * 1024,
    diskWarnRatio: 0.8,
    taskLogLimitBytes: 100 * 1024 * 1024,
    maxEventsPerTask: 10_000,
    autoRepairRounds: 2,
  },
  remote: {
    lsRemoteTimeoutMs: 30_000,
    cloneTimeoutMs: 600_000,
  },
  runtime: {
    codexBin: undefined,
  },
};

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const optionalModelText = z.string().trim().max(200).optional();

export const agentSystemSettingsSchema = z.object({
  analysisIdleTimeoutMs: positiveInt,
  implementationIdleTimeoutMs: positiveInt,
  analysisMaxDurationMs: positiveInt.nullable(),
  implementationMaxDurationMs: positiveInt.nullable(),
  conversationIdleTimeoutMs: positiveInt,
  approvalTtlMs: positiveInt.nullable(),
});

export const modelSystemSettingsSchema = z.object({
  bugfixModel: optionalModelText,
  bugfixReasoningEffort: z.string().trim().max(50).optional(),
  conversationModel: optionalModelText,
  conversationReasoningEffort: z.string().trim().max(50).optional(),
});

export const securitySystemSettingsSchema = z.object({
  conversationDefaults: conversationPolicySchema,
  bugfixAutomationMode: z.enum(["manual", "auto"]).default("manual"),
  analyzeApprovalPolicy: z.enum([
    "on-request",
    "never",
    "untrusted",
    "granular",
  ]),
  analyzeApprovalsReviewer: z.enum([
    "user",
    "auto_review",
    "guardian_subagent",
  ]),
  implementApprovalPolicy: z.enum([
    "on-request",
    "never",
    "untrusted",
    "granular",
  ]),
  implementApprovalsReviewer: z.enum([
    "user",
    "auto_review",
    "guardian_subagent",
  ]),
});

export const projectDefaultsSystemSettingsSchema = z.object({
  instructionSources: z.array(z.string().min(1)).default([]),
  validationCommands: z.array(validationCommandSchema).default([]),
  allowedPaths: z.array(z.string().min(1)).default([]),
  forbiddenPaths: z.array(z.string().min(1)).default([]),
  newValidationCommand: validationCommandSchema,
});

export const storageSystemSettingsSchema = z.object({
  totalDataLimitBytes: positiveInt,
  diskWarnRatio: z.number().min(0).max(1),
  taskLogLimitBytes: positiveInt,
  maxEventsPerTask: positiveInt,
  autoRepairRounds: nonNegativeInt,
});

export const remoteSystemSettingsSchema = z.object({
  lsRemoteTimeoutMs: positiveInt,
  cloneTimeoutMs: positiveInt,
});

export const runtimeSystemSettingsSchema = z.object({
  codexBin: z.string().trim().max(4096).optional(),
});

export const systemSettingsSchema = z.object({
  agent: agentSystemSettingsSchema,
  models: modelSystemSettingsSchema,
  security: securitySystemSettingsSchema,
  projectDefaults: projectDefaultsSystemSettingsSchema,
  storage: storageSystemSettingsSchema,
  remote: remoteSystemSettingsSchema,
  runtime: runtimeSystemSettingsSchema,
});

function omitUndefined<T extends object>(value: T | undefined | null): Partial<T> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

export function mergeSystemSettings(
  stored: unknown,
  defaults: SystemSettings = DEFAULT_SYSTEM_SETTINGS,
): SystemSettings {
  const value =
    stored && typeof stored === "object"
      ? (stored as Partial<SystemSettings>)
      : {};
  const security = omitUndefined(value.security);
  const merged = {
    ...defaults,
    ...omitUndefined(value),
    agent: { ...defaults.agent, ...omitUndefined(value.agent) },
    models: { ...defaults.models, ...omitUndefined(value.models) },
    security: {
      ...defaults.security,
      ...security,
      conversationDefaults: {
        ...defaults.security.conversationDefaults,
        ...omitUndefined(
          (security.conversationDefaults ??
            value.security?.conversationDefaults) as
            | ConversationPolicy
            | undefined,
        ),
      },
    },
    projectDefaults: {
      ...defaults.projectDefaults,
      ...omitUndefined(value.projectDefaults),
    },
    storage: { ...defaults.storage, ...omitUndefined(value.storage) },
    remote: { ...defaults.remote, ...omitUndefined(value.remote) },
    runtime: { ...defaults.runtime, ...omitUndefined(value.runtime) },
  };
  const parsed = systemSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(defaults);
}
