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

export const PROMPT_TEMPLATE_KEYS = [
  "analyze",
  "implement",
  "planQuestion",
] as const;

export type PromptTemplateKey = (typeof PROMPT_TEMPLATE_KEYS)[number];

export interface PromptTemplateDefinition {
  key: PromptTemplateKey;
  label: string;
  description: string;
  placeholders: string[];
}

export const PROMPT_TEMPLATE_DEFINITIONS: PromptTemplateDefinition[] = [
  {
    key: "analyze",
    label: "分析",
    description: "用于分析 Bug、生成修复计划的 Codex 提示词。",
    placeholders: ["contract"],
  },
  {
    key: "implement",
    label: "实施",
    description: "用于在隔离 Worktree 中执行已批准修复计划的 Codex 提示词。",
    placeholders: ["contract", "plan", "validationFeedback"],
  },
  {
    key: "planQuestion",
    label: "计划追问",
    description: "用于回答用户针对修复计划的追问。",
    placeholders: ["contract", "plan", "question"],
  },
];

export const MAX_PROMPT_TEMPLATE_LENGTH = 20_000;

const KNOWN_PLACEHOLDERS = new Set([
  "contract",
  "plan",
  "validationFeedback",
  "question",
]);

const analyzeDefaultTemplate = [
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
  "{{contract}}",
  "",
  "You must not propose Git commit, push, merge request, or production actions.",
].join("\n");

const implementDefaultTemplate = [
  "You are implementing an approved bugfix plan inside an isolated Git worktree.",
  "Only change files listed in the approved plan.",
  "Do not commit, push, or create a merge request.",
  "Write or update regression tests when required.",
  "",
  "Bug contract:",
  "{{contract}}",
  "",
  "Approved repair plan:",
  "{{plan}}",
  "{{#if validationFeedback}}",
  "",
  "The previous implementation did not pass validation. Fix the failures",
  "described below, then re-run the relevant validation commands if useful.",
  "Validation feedback:",
  "{{validationFeedback}}",
  "{{/if}}",
].join("\n");

const planQuestionDefaultTemplate = [
  "You are a bugfix analysis agent. Do not modify files.",
  "A user is reviewing the current repair plan and asked a follow-up question.",
  "Answer the question in plain language. If the current plan should be clarified,",
  "explain the likely impact, but do not change the plan unless the user explicitly asks you to.",
  "",
  "Bug contract:",
  "{{contract}}",
  "",
  "Current repair plan:",
  "{{plan}}",
  "",
  "User question: {{question}}",
].join("\n");

export const DEFAULT_PROMPT_TEMPLATES: Record<PromptTemplateKey, string> = {
  analyze: analyzeDefaultTemplate,
  implement: implementDefaultTemplate,
  planQuestion: planQuestionDefaultTemplate,
};

export interface PromptRenderContext {
  contract: TaskContract;
  plan?: RepairPlan;
  validationFeedback?: string;
  question?: string;
}

function valueForPlaceholder(
  name: string,
  context: PromptRenderContext,
): string {
  switch (name) {
    case "contract":
      return JSON.stringify(context.contract, null, 2);
    case "plan":
      return context.plan ? JSON.stringify(context.plan, null, 2) : "";
    case "validationFeedback":
      return context.validationFeedback ?? "";
    case "question":
      return context.question ?? "";
    default:
      return "";
  }
}

export function collectPromptTemplatePlaceholders(template: string): string[] {
  const names = new Set<string>();
  const placeholderPattern =
    /\{\{\s*(?:#if\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholderPattern.exec(template)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

export function unknownPromptTemplatePlaceholders(
  template: string,
  key: PromptTemplateKey,
): string[] {
  const allowed = new Set(
    PROMPT_TEMPLATE_DEFINITIONS.find((item) => item.key === key)?.placeholders ?? [],
  );
  return collectPromptTemplatePlaceholders(template).filter(
    (name) => !allowed.has(name),
  );
}

function renderConditionalBlocks(
  template: string,
  context: PromptRenderContext,
): string {
  return template.replace(
    /\{\{#if\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (match, name: string, body: string) => {
      if (!KNOWN_PLACEHOLDERS.has(name)) {
        return match;
      }
      const value = valueForPlaceholder(name, context);
      return value ? body : "";
    },
  );
}

export function renderPromptTemplate(
  template: string,
  context: PromptRenderContext,
): string {
  const withoutConditionals = renderConditionalBlocks(template, context);
  return withoutConditionals.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (match, name: string) =>
      KNOWN_PLACEHOLDERS.has(name)
        ? valueForPlaceholder(name, context)
        : match,
  );
}

export function buildAnalyzePrompt(
  contract: TaskContract,
  template: string = DEFAULT_PROMPT_TEMPLATES.analyze,
): string {
  return renderPromptTemplate(template, { contract });
}

export function buildImplementPrompt(
  contract: TaskContract,
  plan: RepairPlan,
  validationFeedback?: string,
  template: string = DEFAULT_PROMPT_TEMPLATES.implement,
): string {
  return renderPromptTemplate(template, {
    contract,
    plan,
    validationFeedback,
  });
}

export function buildPlanQuestionPrompt(
  contract: TaskContract,
  plan: RepairPlan,
  question: string,
  template: string = DEFAULT_PROMPT_TEMPLATES.planQuestion,
): string {
  return renderPromptTemplate(template, {
    contract,
    plan,
    question,
  });
}
