import { describe, expect, it } from "vitest";
import {
  buildAnalyzePrompt,
  buildImplementPrompt,
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

  it("rejects invalid state transitions", () => {
    expect(() => transitionTask("DRAFT", "ACCEPTED")).toThrow();
  });

  it("defines the output schema", () => {
    expect(planOutputSchema.additionalProperties).toBe(false);
  });
});
