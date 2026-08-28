import { describe, expect, it } from "vitest";
import type { WorkflowState } from "./api.js";
import {
  currentStepForStatus,
  nextActionForState,
  WORKFLOW_STEPS,
} from "./workflow-model.js";

function state(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    task: {
      id: "task-1",
      projectId: "project-1",
      title: "示例任务",
      bugDescription: "示例问题",
      observedBehavior: "",
      expectedBehavior: "",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    project: null,
    contract: undefined,
    worktree: null,
    attention: {
      taskId: "task-1",
      clarification: null,
      planApproval: null,
      pendingApprovals: 0,
      validation: { passed: 0, failed: 0, timeout: 0, skipped: 0 },
    },
    planApproval: null,
    pendingApprovals: [],
    validations: [],
    report: null,
    diff: null,
    jobs: [],
    ...overrides,
  };
}

describe("workflow model", () => {
  it("maps statuses to the expected current step", () => {
    expect(currentStepForStatus("DRAFT")).toBe("analyze");
    expect(currentStepForStatus("WAITING_FOR_PLAN_APPROVAL")).toBe("plan");
    expect(currentStepForStatus("IMPLEMENTING")).toBe("implement");
    expect(currentStepForStatus("VALIDATING")).toBe("validate");
    expect(currentStepForStatus("WAITING_FOR_ACCEPTANCE")).toBe("accept");
    expect(currentStepForStatus("ACCEPTED")).toBeNull();
  });

  it("keeps all steps in workflow order", () => {
    expect(WORKFLOW_STEPS.map((step) => step.key)).toEqual([
      "analyze",
      "plan",
      "implement",
      "validate",
      "accept",
    ]);
  });

  it("gives a single clear primary action for each actionable stage", () => {
    expect(nextActionForState(state()).key).toBe("start-analyze");
    expect(
      nextActionForState(
        state({ task: { ...state().task, status: "WAITING_FOR_PLAN_APPROVAL" } }),
      ).key,
    ).toBe("approve-plan");
    expect(
      nextActionForState(
        state({ task: { ...state().task, status: "IMPLEMENTING" } }),
      ).key,
    ).toBe("start-implement");
    expect(
      nextActionForState(
        state({ task: { ...state().task, status: "WAITING_FOR_ACCEPTANCE" } }),
      ).key,
    ).toBe("build-report");
  });

  it("prioritizes pending approvals during implementation", () => {
    const next = nextActionForState(
      state({
        task: { ...state().task, status: "IMPLEMENTING" },
        attention: {
          ...state().attention,
          pendingApprovals: 2,
        },
      }),
    );
    expect(next.key).toBe("handle-approvals");
  });

  it("prioritizes failed validation during validation", () => {
    const next = nextActionForState(
      state({
        task: { ...state().task, status: "VALIDATING" },
        validations: [
          {
            command: {
              id: "test",
              label: "test",
              command: ["npm", "test"],
              timeoutSec: 60,
            },
            cwd: "/repo",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            exitCode: 1,
            status: "failed",
            stdout: "",
            stderr: "",
          },
        ],
      }),
    );
    expect(next.key).toBe("continue-fix");
    expect(next.href).toContain("#validation-action");
  });
});
