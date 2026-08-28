import { z } from "zod";
import type {
  BugfixTask,
  Project,
  TaskContract,
  ValidationCommand,
} from "./domain.js";

export const taskStatusSchema = z.enum([
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
]);

export const absolutePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => /^(\/|[A-Za-z]:[\\/])/.test(value),
    "path must be absolute",
  );

export const validationCommandSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  command: z.array(z.string().min(1)).min(1),
  timeoutSec: z.number().int().positive().max(3600),
  required: z.boolean().optional(),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  repoPath: absolutePathSchema,
  instructionSources: z.array(z.string().min(1)).default([]),
  validationCommands: z.array(validationCommandSchema).default([]),
  allowedPaths: z.array(z.string().min(1)).default([]),
  forbiddenPaths: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createProjectInputSchema = projectSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    instructionSources: z.array(z.string().min(1)).default([]),
    validationCommands: z.array(validationCommandSchema).default([]),
    allowedPaths: z.array(z.string().min(1)).default([]),
    forbiddenPaths: z.array(z.string().min(1)).default([]),
  });

export const bugfixTaskSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  bugDescription: z.string().min(1),
  observedBehavior: z.string().default(""),
  expectedBehavior: z.string().default(""),
  reproductionSteps: z.string().optional(),
  reproductionCommand: z.string().optional(),
  logs: z.string().optional(),
  relatedFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  status: taskStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createBugfixTaskInputSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().max(200).default(""),
  bugDescription: z.string().min(1),
  observedBehavior: z.string().default(""),
  expectedBehavior: z.string().default(""),
  reproductionSteps: z.string().optional(),
  reproductionCommand: z.string().optional(),
  logs: z.string().optional(),
  relatedFiles: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
});

export const taskContractSchema = z.object({
  schemaVersion: z.literal("1.0"),
  goal: z.string().min(1),
  observedBehavior: z.string().default(""),
  expectedBehavior: z.string().default(""),
  reproduction: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  scope: z.object({
    allowedPaths: z.array(z.string().min(1)).default([]),
    forbiddenPaths: z.array(z.string().min(1)).default([]),
  }),
  validationCommands: z.array(validationCommandSchema).default([]),
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type CreateBugfixTaskInput = z.infer<typeof createBugfixTaskInputSchema>;

export function createTaskContract(
  task: BugfixTask,
  project: Project,
): TaskContract {
  return {
    schemaVersion: "1.0",
    goal: task.bugDescription || task.title,
    observedBehavior: task.observedBehavior || task.bugDescription,
    expectedBehavior:
      task.expectedBehavior ||
      "未明确提供，请根据问题描述推断，并在修复计划中标注为待确认项。",
    reproduction: [task.reproductionSteps, task.reproductionCommand]
      .filter(Boolean)
      .join("\n"),
    acceptanceCriteria: task.acceptanceCriteria,
    constraints: task.constraints,
    scope: {
      allowedPaths: project.allowedPaths,
      forbiddenPaths: project.forbiddenPaths,
    },
    validationCommands: project.validationCommands,
  };
}

export function normalizeValidationCommands(
  commands: ValidationCommand[],
): ValidationCommand[] {
  return commands.map((command) => ({
    ...command,
    required: command.required ?? true,
  }));
}
