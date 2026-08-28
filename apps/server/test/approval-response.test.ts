import { describe, expect, it } from "vitest";
import { buildApprovalResponse } from "../src/services/agent-orchestrator.js";

describe("buildApprovalResponse", () => {
  it("maps v2 command/file decisions to accept/decline/cancel", () => {
    expect(
      buildApprovalResponse(
        "item/commandExecution/requestApproval",
        "accept",
        {},
      ),
    ).toEqual({ decision: "accept" });
    expect(
      buildApprovalResponse("item/fileChange/requestApproval", "decline", {}),
    ).toEqual({ decision: "decline" });
  });

  it("grants requested permissions on accept and empty permissions otherwise", () => {
    const permissions = { fileSystem: { writableRoots: ["/worktree"] } };
    expect(
      buildApprovalResponse(
        "item/permissions/requestApproval",
        "accept",
        { permissions },
      ),
    ).toEqual({ permissions, scope: "turn" });
    expect(
      buildApprovalResponse("item/permissions/requestApproval", "decline", {
        permissions,
      }),
    ).toEqual({ permissions: {}, scope: "turn" });
  });

  it("maps legacy approval methods to ReviewDecision shapes", () => {
    expect(buildApprovalResponse("execCommandApproval", "accept", {})).toEqual({
      decision: "approved",
    });
    expect(buildApprovalResponse("applyPatchApproval", "decline", {})).toEqual({
      decision: { denied: { rejection: "declined by reviewer" } },
    });
    expect(buildApprovalResponse("execCommandApproval", "cancel", {})).toEqual({
      decision: "abort",
    });
  });
});
