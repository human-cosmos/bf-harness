import { describe, expect, it } from "vitest";
import {
  classifyApprovalRequest,
  makePolicyContext,
} from "../src/services/approval-policy.js";

const worktree = "/tmp/bugfix-harness-worktree";
const context = makePolicyContext({
  worktreeRoot: worktree,
  allowedPaths: [`${worktree}/src`],
  forbiddenPaths: [`${worktree}/secrets`],
  plannedPaths: [`${worktree}/src/index.ts`],
  declaredValidationCommands: [
    { command: ["npm", "test"] },
    { command: ["npm", "run", "lint"] },
  ],
});

describe("approval policy", () => {
  it("allows planned file writes", () => {
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/src/index.ts`, action: "write" },
        context,
      ).level,
    ).toBe("autoAllow");
  });

  it("prompts for out-of-plan writes", () => {
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/docs/readme.md`, action: "write" },
        context,
      ).level,
    ).toBe("prompt");
  });

  it("denies forbidden paths", () => {
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/secrets/token.txt`, action: "write" },
        context,
      ).level,
    ).toBe("deny");
  });

  it("denies outside-worktree file changes", () => {
    expect(
      classifyApprovalRequest(
        { kind: "file", path: "/tmp/other/file.txt", action: "write" },
        context,
      ).level,
    ).toBe("deny");
  });

  it("allows declared validation commands", () => {
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "npm test", cwd: worktree },
        context,
      ).level,
    ).toBe("autoAllow");
  });

  it("prompts for dependency installs", () => {
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "npm install lodash", cwd: worktree },
        context,
      ).level,
    ).toBe("prompt");
  });

  it("denies git commit and push", () => {
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "git commit -m fix", cwd: worktree },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "git push origin main", cwd: worktree },
        context,
      ).level,
    ).toBe("deny");
  });
});
