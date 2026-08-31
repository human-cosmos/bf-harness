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

  it("denies git commit and push when global options are present", () => {
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "git -C /tmp/repo push origin main",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "git --no-pager commit -m fix",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "git --git-dir=/tmp/repo push origin main",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "git --git-dir /tmp/repo commit -m fix",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "git -c user.name=test commit -m fix",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
  });

  it("denies gh and glab merge-request creation when options are present", () => {
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "gh --repo owner/repo pr create",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "gh pr create --repo owner/repo",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "glab --config-file /tmp/glab.cfg mr create",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("deny");
  });

  it("does not deny safe or unrelated commands with global options", () => {
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "git --no-pager status",
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("autoAllow");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: `git -C ${worktree} log`,
          cwd: worktree,
        },
        context,
      ).level,
    ).toBe("autoAllow");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "gh pr view",
          cwd: worktree,
        },
        context,
      ).level,
    ).not.toBe("deny");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "glab mr list",
          cwd: worktree,
        },
        context,
      ).level,
    ).not.toBe("deny");
  });

  it("auto-allows writes inside an allowed path even when unplanned", () => {
    const ctx = makePolicyContext({
      worktreeRoot: worktree,
      allowedPaths: [`${worktree}/src`],
      forbiddenPaths: [],
      plannedPaths: [],
      declaredValidationCommands: [],
    });
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/src/new-file.ts`, action: "write" },
        ctx,
      ).level,
    ).toBe("autoAllow");
  });

  it("maps relative scope paths against the worktree root", () => {
    const ctx = makePolicyContext({
      worktreeRoot: worktree,
      allowedPaths: ["src"],
      forbiddenPaths: ["node_modules"],
      plannedPaths: ["src/index.ts"],
      declaredValidationCommands: [],
    });
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/node_modules/pkg/index.js`, action: "write" },
        ctx,
      ).level,
    ).toBe("deny");
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/src/index.ts`, action: "write" },
        ctx,
      ).level,
    ).toBe("autoAllow");
  });

  it("maps absolute repo paths into the worktree", () => {
    const ctx = makePolicyContext({
      worktreeRoot: `${worktree}/checkout`,
      repoRoot: worktree,
      allowedPaths: [`${worktree}/src`],
      forbiddenPaths: [`${worktree}/secrets`],
      plannedPaths: [`${worktree}/src/index.ts`],
      declaredValidationCommands: [],
    });
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/checkout/src/index.ts`, action: "write" },
        ctx,
      ).level,
    ).toBe("autoAllow");
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/checkout/secrets/token.txt`, action: "write" },
        ctx,
      ).level,
    ).toBe("deny");
  });

  it("does not auto-allow destructive read-command variants", () => {
    const ctx = makePolicyContext({
      worktreeRoot: worktree,
      allowedPaths: [],
      forbiddenPaths: [],
      plannedPaths: [],
      declaredValidationCommands: [],
    });
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "sed -i s/a/b/ file.txt", cwd: worktree },
        ctx,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "sed -i.bak s/a/b/ file.txt", cwd: worktree },
        ctx,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "sed -ie s/a/b/ file.txt", cwd: worktree },
        ctx,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "sed -ni s/a/b/ file.txt", cwd: worktree },
        ctx,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        {
          kind: "command",
          command: "sed --in-place=.bak s/a/b/ file.txt",
          cwd: worktree,
        },
        ctx,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "find . -name node_modules -delete", cwd: worktree },
        ctx,
      ).level,
    ).toBe("prompt");
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "cat /etc/passwd", cwd: worktree },
        ctx,
      ).level,
    ).toBe("prompt");
  });

  it("does not widen planned file writes to the whole parent directory", () => {
    const ctx = makePolicyContext({
      worktreeRoot: worktree,
      allowedPaths: [],
      forbiddenPaths: [],
      plannedPaths: [`${worktree}/src/index.ts`],
      declaredValidationCommands: [],
    });

    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/src/index.ts`, action: "write" },
        ctx,
      ).level,
    ).toBe("autoAllow");
    expect(
      classifyApprovalRequest(
        { kind: "file", path: `${worktree}/src/credentials.json`, action: "write" },
        ctx,
      ).level,
    ).toBe("prompt");
  });

  it("denies read commands running outside the worktree", () => {
    const ctx = makePolicyContext({
      worktreeRoot: worktree,
      allowedPaths: [],
      forbiddenPaths: [],
      plannedPaths: [],
      declaredValidationCommands: [],
    });
    expect(
      classifyApprovalRequest(
        { kind: "command", command: "cat README.md", cwd: "/tmp/elsewhere" },
        ctx,
      ).level,
    ).toBe("deny");
  });
});
