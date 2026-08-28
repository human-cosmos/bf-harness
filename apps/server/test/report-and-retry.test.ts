import { describe, expect, it } from "vitest";
import { DeliveryReportService } from "../src/services/delivery-report-service.js";
import {
  MAX_AUTO_REPAIR_ROUNDS,
  canAutoRepair,
  nextValidationAction,
} from "../src/services/retry-policy.js";

describe("DeliveryReportService", () => {
  it("links the report to diff and validation results", () => {
    const report = new DeliveryReportService().build({
      task: {
        id: "task-1",
        projectId: "project-1",
        title: "fix",
        bugDescription: "broken",
        observedBehavior: "error",
        expectedBehavior: "works",
        acceptanceCriteria: ["test passes"],
        constraints: [],
        status: "VALIDATING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      contract: {
        schemaVersion: "1.0",
        goal: "fix",
        observedBehavior: "error",
        expectedBehavior: "works",
        acceptanceCriteria: ["test passes"],
        constraints: [],
        scope: { allowedPaths: [], forbiddenPaths: [] },
        validationCommands: [],
      },
      plan: {
        problemSummary: "broken",
        rootCauseHypothesis: "bad code",
        evidence: ["log"],
        proposedFiles: ["src/a.ts"],
        fixStrategy: "fix",
        regressionTests: ["npm test"],
        validationCommands: ["npm test"],
        risks: [],
        openQuestions: [],
      },
      diff: {
        files: [{ path: "src/a.ts", status: "modified" }],
        unifiedDiff: "diff",
        stats: {
          total: 1,
          added: 0,
          modified: 1,
          deleted: 0,
          untracked: 0,
          renamed: 0,
        },
      },
      validationResults: [
        {
          command: { id: "test", label: "test", command: ["npm", "test"], timeoutSec: 60 },
          cwd: "/tmp",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          exitCode: 0,
          status: "passed",
          stdout: "",
          stderr: "",
        },
      ],
    });

    expect(report.modifiedFiles).toEqual(["src/a.ts"]);
    expect(report.validationResults).toHaveLength(1);
    expect(report.acceptanceChecklist).toEqual([{ criterion: "test passes" }]);
  });
});

describe("retry policy", () => {
  it("allows at most two auto-repair rounds", () => {
    expect(canAutoRepair(0)).toBe(true);
    expect(canAutoRepair(1)).toBe(true);
    expect(canAutoRepair(MAX_AUTO_REPAIR_ROUNDS)).toBe(false);
  });

  it("blocks after the second same validation failure", () => {
    expect(
      nextValidationAction({ currentRound: 2, sameFailure: true }),
    ).toBe("BLOCKED");
  });
});
