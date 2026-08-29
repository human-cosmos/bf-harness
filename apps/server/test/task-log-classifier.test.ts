import { describe, expect, it } from "vitest";
import {
  classifyHarnessEvent,
  classifyRuntimeNotification,
} from "../src/services/task-log-classifier.js";

describe("task log classifier", () => {
  it("classifies noisy reasoning deltas as debug runtime logs", () => {
    const result = classifyRuntimeNotification(
      "item/reasoning/textDelta",
      { delta: "thinking..." },
      "analyze",
    );
    expect(result).toEqual({
      level: "debug",
      source: "runtime",
      phase: "analyze",
      message: "item/reasoning/textDelta",
    });
  });

  it("classifies approval requests as warnings", () => {
    const result = classifyRuntimeNotification(
      "item/fileChange/requestApproval",
      { path: "/worktree/src/a.ts" },
      "implement",
    );
    expect(result.level).toBe("warn");
    expect(result.source).toBe("approval");
    expect(result.phase).toBe("implement");
  });

  it("classifies failed jobs and failed validations as errors", () => {
    const job = classifyHarnessEvent("job.failed", {
      job: { kind: "implement", message: "开始实施" },
    });
    expect(job.level).toBe("error");
    expect(job.message).toContain("后台任务失败");

    const validation = classifyHarnessEvent("validation.completed", {
      passed: 1,
      failed: 1,
      timeout: 0,
    });
    expect(validation.source).toBe("validation");
    expect(validation.phase).toBe("validate");
    expect(validation.level).toBe("error");
  });

  it("classifies workflow status changes", () => {
    const result = classifyHarnessEvent("task.status_changed", {
      status: "IMPLEMENTING",
    });
    expect(result.source).toBe("workflow");
    expect(result.phase).toBe("lifecycle");
    expect(result.message).toContain("IMPLEMENTING");
  });
});
