import { describe, expect, it } from "vitest";
import type { WorkflowState } from "./api.js";
import {
  currentStepForStatus,
  effectiveStatusForState,
  nextActionForState,
  stepperForState,
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

  it("distinguishes working from awaiting and ready on the current step", () => {
    expect(
      stepperForState(
        state({ task: { ...state().task, status: "ANALYZING" } }),
      ).steps[0].state,
    ).toBe("working");

    expect(
      stepperForState(
        state({ task: { ...state().task, status: "WAITING_FOR_PLAN_APPROVAL" } }),
      ).steps[1].state,
    ).toBe("awaiting");

    expect(
      stepperForState(
        state({ task: { ...state().task, status: "IMPLEMENTING" } }),
      ).steps[2].state,
    ).toBe("ready");
  });

  it("shows a running implement job as working instead of ready", () => {
    const next = stepperForState(
      state({
        task: { ...state().task, status: "IMPLEMENTING" },
        jobs: [
          {
            id: "job-1",
            taskId: "task-1",
            kind: "implement",
            status: "running",
            message: "开始实施",
            startedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(next.steps[2].state).toBe("working");
  });

  it("marks an accepted task as fully done", () => {
    const next = stepperForState(
      state({ task: { ...state().task, status: "ACCEPTED" } }),
    );
    expect(next.steps.every((step) => step.state === "done")).toBe(true);
    expect(next.progress).toBe(1);
  });

  it("marks validation as failed when checks failed without a background job", () => {
    const next = stepperForState(
      state({
        task: { ...state().task, status: "FAILED" },
        attention: {
          ...state().attention,
          validation: { ...state().attention.validation, failed: 1 },
        },
      }),
    );
    expect(next.steps[3].state).toBe("failed");
  });

  it("clarifies the caption when validation needs a follow-up fix", () => {
    const next = stepperForState(
      state({
        task: { ...state().task, status: "VALIDATING" },
        attention: {
          ...state().attention,
          validation: { ...state().attention.validation, failed: 1 },
        },
      }),
    );
    expect(next.caption).toBe("检查未通过 · 等待你继续修复");
  });

  it("offers a manual re-run when the task is blocked", () => {
    const next = nextActionForState(
      state({
        task: { ...state().task, status: "BLOCKED" },
      }),
    );
    expect(next.key).toBe("validate");
    expect(next.href).toContain("/diff#validation-action");
  });

  it("overrides the badge while implementation is actually running", () => {
    const next = effectiveStatusForState(
      state({
        task: { ...state().task, status: "IMPLEMENTING" },
        jobs: [
          {
            id: "job-1",
            taskId: "task-1",
            kind: "implement",
            status: "running",
            message: "开始实施",
            startedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(next.label).toBe("实施中");
    expect(next.tone).toBe("active");
  });
});
