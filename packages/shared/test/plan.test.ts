import { describe, expect, it } from "vitest";
import {
  buildAnalyzePrompt,
  buildImplementPrompt,
  buildPlanQuestionPrompt,
  coerceRepairPlan,
  collectPromptTemplatePlaceholders,
  renderPromptTemplate,
  unknownPromptTemplatePlaceholders,
  planOutputSchema,
  planSchema,
  transitionTask,
} from "../src/index.js";

const plan = {
  problemSummary: "login fails",
  rootCauseHypothesis: "bad validation",
  evidence: ["stack trace"],
  proposedFiles: ["src/login.ts"],
  fixStrategy: "fix validation",
  regressionTests: ["test login"],
  validationCommands: ["npm test"],
  risks: [],
  openQuestions: [],
};

describe("plan", () => {
  it("validates a repair plan", () => {
    expect(planSchema.parse(plan).problemSummary).toBe("login fails");
  });

  it("coerces alternate agent plan shapes and repo-absolute paths", () => {
    const parsed = planSchema.parse(
      coerceRepairPlan(
        {
          analysis: "result.txt is missing",
          repairPlan: [
            {
              action: "create_file",
              path: "C:/tmp/repo/result.txt",
              content: "E2E_OK",
            },
          ],
          verification: ["read result.txt"],
          risks: [],
        },
        ["C:/tmp/repo"],
      ),
    );
    expect(parsed.problemSummary).toBe("result.txt is missing");
    expect(parsed.proposedFiles).toEqual(["result.txt"]);
    expect(parsed.regressionTests).toEqual(["read result.txt"]);
  });

  it("wraps a string evidence field into an array", () => {
    const parsed = planSchema.parse(
      coerceRepairPlan({
        ...plan,
        evidence: "only app.txt is present",
      }),
    );
    expect(parsed.evidence).toEqual(["only app.txt is present"]);
  });

  it("coerces object-shaped validation commands to strings", () => {
    const parsed = planSchema.parse(
      coerceRepairPlan({
        ...plan,
        validationCommands: [
          { id: "echo", label: "Echo", command: ["node", "-e", "console.log('ok')"] },
        ],
      }),
    );
    expect(parsed.validationCommands).toEqual([
      "node -e console.log('ok')",
    ]);
  });

  it("requires evidence and proposed files", () => {
    expect(() =>
      planSchema.parse({ ...plan, evidence: [], proposedFiles: [] }),
    ).toThrow();
  });

  it("builds an analysis prompt without allowing modifications", () => {
    const prompt = buildAnalyzePrompt({
      schemaVersion: "1.0",
      goal: "fix",
      observedBehavior: "broken",
      expectedBehavior: "works",
      acceptanceCriteria: [],
      constraints: [],
      scope: { allowedPaths: [], forbiddenPaths: [] },
      validationCommands: [],
    });
    expect(prompt).toContain("Do not modify files");
  });

  it("builds an implementation prompt with the approved plan", () => {
    const contract = {
      schemaVersion: "1.0" as const,
      goal: "fix",
      observedBehavior: "broken",
      expectedBehavior: "works",
      acceptanceCriteria: [],
      constraints: [],
      scope: { allowedPaths: [], forbiddenPaths: [] },
      validationCommands: [],
    };
    expect(buildImplementPrompt(contract, plan)).toContain("approved");
  });

  it("renders a custom analysis template", () => {
    const contract = {
      schemaVersion: "1.0" as const,
      goal: "fix",
      observedBehavior: "broken",
      expectedBehavior: "works",
      acceptanceCriteria: [],
      constraints: [],
      scope: { allowedPaths: [], forbiddenPaths: [] },
      validationCommands: [],
    };

    const prompt = buildAnalyzePrompt(
      contract,
      "Custom contract: {{contract}}",
    );

    expect(prompt).toContain("Custom contract:");
    expect(prompt).toContain('"goal": "fix"');
  });

  it("renders plan question variables and skips empty validation feedback", () => {
    const contract = {
      schemaVersion: "1.0" as const,
      goal: "fix",
      observedBehavior: "broken",
      expectedBehavior: "works",
      acceptanceCriteria: [],
      constraints: [],
      scope: { allowedPaths: [], forbiddenPaths: [] },
      validationCommands: [],
    };

    const question = buildPlanQuestionPrompt(
      contract,
      plan,
      "why?",
      "Plan: {{plan}} Question: {{question}}",
    );
    expect(question).toContain('"problemSummary": "login fails"');
    expect(question).toContain("Question: why?");

    const implementation = buildImplementPrompt(
      contract,
      plan,
      undefined,
      "{{#if validationFeedback}}FEEDBACK:{{validationFeedback}}{{/if}}",
    );
    expect(implementation).toBe("");
  });

  it("renders raw template placeholders with the shared renderer", () => {
    const contract = {
      schemaVersion: "1.0" as const,
      goal: "fix",
      observedBehavior: "broken",
      expectedBehavior: "works",
      acceptanceCriteria: [],
      constraints: [],
      scope: { allowedPaths: [], forbiddenPaths: [] },
      validationCommands: [],
    };

    const rendered = renderPromptTemplate("goal={{contract}}", { contract });
    expect(rendered).toContain('"goal": "fix"');
  });

  it("keeps unknown placeholders visible instead of silently erasing them", () => {
    const contract = {
      schemaVersion: "1.0" as const,
      goal: "fix",
      observedBehavior: "broken",
      expectedBehavior: "works",
      acceptanceCriteria: [],
      constraints: [],
      scope: { allowedPaths: [], forbiddenPaths: [] },
      validationCommands: [],
    };

    const rendered = renderPromptTemplate("Contract={{contarct}}", {
      contract,
    });
    expect(rendered).toBe("Contract={{contarct}}");
    expect(unknownPromptTemplatePlaceholders("{{contarct}}", "analyze")).toEqual([
      "contarct",
    ]);
    expect(collectPromptTemplatePlaceholders("{{contract}} {{#if plan}}x{{/if}}")).toEqual([
      "contract",
      "plan",
    ]);
  });

  it("rejects invalid state transitions", () => {
    expect(() => transitionTask("DRAFT", "ACCEPTED")).toThrow();
  });

  it("defines the output schema", () => {
    expect(planOutputSchema.additionalProperties).toBe(false);
  });
});
