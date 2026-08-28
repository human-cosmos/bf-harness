import { z } from "zod";
import type { TaskContract } from "./domain.js";

export const planSchema = z.object({
  problemSummary: z.string().min(1),
  rootCauseHypothesis: z.string().min(1),
  evidence: z.array(z.string()).min(1),
  proposedFiles: z.array(z.string()).min(1),
  fixStrategy: z.string().min(1),
  regressionTests: z.array(z.string()).min(1),
  validationCommands: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type RepairPlan = z.infer<typeof planSchema>;

export const planOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "problemSummary",
    "rootCauseHypothesis",
    "evidence",
    "proposedFiles",
    "fixStrategy",
    "regressionTests",
    "validationCommands",
    "risks",
    "openQuestions",
  ],
  properties: {
    problemSummary: { type: "string" },
    rootCauseHypothesis: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    proposedFiles: { type: "array", items: { type: "string" } },
    fixStrategy: { type: "string" },
    regressionTests: { type: "array", items: { type: "string" } },
    validationCommands: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildAnalyzePrompt(contract: TaskContract): string {
  return [
    "You are a bugfix analysis agent. Do not modify files.",
    "Analyze the following bug contract and produce a repair plan.",
    "The bug description may be incomplete or non-technical.",
    "If information required for a safe repair plan is missing or ambiguous,",
    "call the request_user_input tool with focused questions, then wait for answers",
    "before finalizing the plan. Do not invent important business rules.",
    "Keep analysis focused: do not perform an open-ended repository audit.",
    "Use only the tool calls needed to form a concrete repair plan.",
    "If the request is too broad to form one concrete plan, ask for clarification instead.",
    "Return only a JSON object matching the requested output schema.",
    "",
    "Bug contract:",
    JSON.stringify(contract, null, 2),
    "",
    "You must not propose Git commit, push, merge request, or production actions.",
  ].join("\n");
}

export function buildImplementPrompt(
  contract: TaskContract,
  plan: RepairPlan,
  validationFeedback?: string,
): string {
  const sections = [
    "You are implementing an approved bugfix plan inside an isolated Git worktree.",
    "Only change files listed in the approved plan.",
    "Do not commit, push, or create a merge request.",
    "Write or update regression tests when required.",
    "",
    "Bug contract:",
    JSON.stringify(contract, null, 2),
    "",
    "Approved repair plan:",
    JSON.stringify(plan, null, 2),
  ];

  if (validationFeedback) {
    sections.push(
      "",
      "The previous implementation did not pass validation. Fix the failures",
      "described below, then re-run the relevant validation commands if useful.",
      "Validation feedback:",
      validationFeedback,
    );
  }

  return sections.join("\n");
}

export function buildPlanQuestionPrompt(
  contract: TaskContract,
  plan: RepairPlan,
  question: string,
): string {
  return [
    "You are a bugfix analysis agent. Do not modify files.",
    "A user is reviewing the current repair plan and asked a follow-up question.",
    "Answer the question in plain language. If the current plan should be clarified,",
    "explain the likely impact, but do not change the plan unless the user explicitly asks you to.",
    "",
    "Bug contract:",
    JSON.stringify(contract, null, 2),
    "",
    "Current repair plan:",
    JSON.stringify(plan, null, 2),
    "",
    `User question: ${question}`,
  ].join("\n");
}
