import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyApprovalRequest,
  makePolicyContext,
} from "./approval-policy.mjs";

const root = "/tmp/bugfix-harness-repo";
const worktree = "/tmp/bugfix-harness-worktree";
const allowedFile = `${worktree}/src/index.ts`;
const context = makePolicyContext({
  worktreeRoot: worktree,
  allowedPaths: [`${worktree}/src`],
  forbiddenPaths: [`${worktree}/secrets`],
  plannedPaths: [allowedFile],
  declaredValidationCommands: [
    { command: ["npm", "test"] },
    { command: ["npm", "run", "lint"] },
  ],
});

test("reads inside worktree are auto allowed", () => {
  const result = classifyApprovalRequest(
    { kind: "file", path: allowedFile, action: "read" },
    context,
  );
  assert.equal(result.level, "autoAllow");
});

test("planned writes inside worktree are auto allowed", () => {
  const result = classifyApprovalRequest(
    { kind: "file", path: allowedFile, action: "write" },
    context,
  );
  assert.equal(result.level, "autoAllow");
});

test("out-of-plan writes require prompt", () => {
  const result = classifyApprovalRequest(
    { kind: "file", path: `${worktree}/docs/README.md`, action: "write" },
    context,
  );
  assert.equal(result.level, "prompt");
});

test("deletes require prompt", () => {
  const result = classifyApprovalRequest(
    { kind: "file", path: allowedFile, action: "delete" },
    context,
  );
  assert.equal(result.level, "prompt");
});

test("forbidden paths are denied", () => {
  const result = classifyApprovalRequest(
    { kind: "file", path: `${worktree}/secrets/token.txt`, action: "write" },
    context,
  );
  assert.equal(result.level, "deny");
});

test("outside-worktree file changes are denied", () => {
  const result = classifyApprovalRequest(
    { kind: "file", path: `${root}/config.yaml`, action: "write" },
    context,
  );
  assert.equal(result.level, "deny");
});

test("git history inspection is auto allowed", () => {
  const result = classifyApprovalRequest(
    { kind: "command", command: "git log --oneline", cwd: worktree },
    context,
  );
  assert.equal(result.level, "autoAllow");
});

test("declared validation commands are auto allowed", () => {
  const result = classifyApprovalRequest(
    { kind: "command", command: "npm test", cwd: worktree },
    context,
  );
  assert.equal(result.level, "autoAllow");
});

test("dependency install requires prompt", () => {
  const result = classifyApprovalRequest(
    { kind: "command", command: "npm install lodash", cwd: worktree },
    context,
  );
  assert.equal(result.level, "prompt");
});

test("network commands require prompt", () => {
  const result = classifyApprovalRequest(
    { kind: "command", command: "curl https://example.com", cwd: worktree },
    context,
  );
  assert.equal(result.level, "prompt");
});

test("git commit, push, and MR are permanently denied", () => {
  for (const command of [
    "git commit -m fix",
    "git push origin main",
    "glab mr create",
  ]) {
    const result = classifyApprovalRequest(
      { kind: "command", command, cwd: worktree },
      context,
    );
    assert.equal(result.level, "deny", command);
  }
});

test("commands outside worktree are denied", () => {
  const result = classifyApprovalRequest(
    { kind: "command", command: "make deploy", cwd: root },
    context,
  );
  assert.equal(result.level, "deny");
});
