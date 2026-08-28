import { describe, expect, it } from "vitest";
import {
  groupFailedValidationRuns,
  nextValidationAction,
  validationFailureSignature,
} from "../src/services/retry-policy.js";

function failedRow(
  id: string,
  runId: string,
  commandId = "test",
  exitCode: number | null = 1,
  stderr = "boom",
): Record<string, unknown> {
  return {
    id,
    validation_run_id: runId,
    command_id: commandId,
    status: "failed",
    exit_code: exitCode,
    stderr,
    stdout: "",
    created_at: id,
  };
}

describe("retry policy", () => {
  it("groups failed validation rows by run", () => {
    const runs = groupFailedValidationRuns([
      failedRow("a", "run-1"),
      failedRow("b", "run-1"),
      failedRow("c", "run-2"),
    ]);

    expect(runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(runs[0]?.failures).toHaveLength(2);
  });

  it("detects repeated failure signatures", () => {
    const first = validationFailureSignature([failedRow("a", "run-1")]);
    const same = validationFailureSignature([failedRow("c", "run-2")]);
    const different = validationFailureSignature([
      failedRow("d", "run-3", "other", 2, "different"),
    ]);

    expect(same).toBe(first);
    expect(different).not.toBe(first);
  });

  it("blocks when the same failure reaches the repair limit", () => {
    expect(
      nextValidationAction({ currentRound: 2, sameFailure: true }),
    ).toBe("BLOCKED");
    expect(
      nextValidationAction({ currentRound: 2, sameFailure: false }),
    ).toBe("REPAIR");
  });
});
