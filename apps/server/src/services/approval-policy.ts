import { isAbsolute, relative, resolve } from "node:path";

export type RiskLevel = "autoAllow" | "prompt" | "deny";

export interface PolicyDecision {
  level: RiskLevel;
  reason: string;
}

export interface ValidationCommandEntry {
  command: string[];
}

export interface PolicyContext {
  worktreeRoot: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  plannedPaths: string[];
  declaredValidationCommands: ValidationCommandEntry[];
}

export type ApprovalRequest =
  | { kind: "command"; command: string; cwd: string }
  | { kind: "file"; path: string; action: "read" | "write" | "delete" }
  | { kind: "network"; host?: string }
  | { kind: "permissions"; reason?: string };

export function makePolicyContext(input: {
  worktreeRoot: string;
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  plannedPaths?: string[];
  declaredValidationCommands?: ValidationCommandEntry[];
}): PolicyContext {
  return {
    worktreeRoot: resolve(input.worktreeRoot),
    allowedPaths: (input.allowedPaths ?? []).map((path) => resolve(path)),
    forbiddenPaths: (input.forbiddenPaths ?? []).map((path) => resolve(path)),
    plannedPaths: (input.plannedPaths ?? []).map((path) => resolve(path)),
    declaredValidationCommands: input.declaredValidationCommands ?? [],
  };
}

function isInside(root: string, target: string): boolean {
  if (!isAbsolute(root) || !isAbsolute(target)) {
    return false;
  }
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function commandTokens(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function sameTokens(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function classifyCommand(
  request: { command: string; cwd: string },
  context: PolicyContext,
): PolicyDecision {
  const tokens = commandTokens(request.command);
  const joined = tokens.join(" ").toLowerCase();
  const first = tokens[0]?.toLowerCase() ?? "";

  if (
    joined.startsWith("git commit") ||
    joined.startsWith("git push") ||
    joined.startsWith("glab mr create") ||
    joined.startsWith("gh pr create") ||
    joined.includes("merge-request") ||
    joined.includes("create pr")
  ) {
    return { level: "deny", reason: "git commit/push/MR is permanently forbidden" };
  }

  const declared = context.declaredValidationCommands.some((entry) =>
    sameTokens(commandTokens(entry.command.join(" ")), tokens),
  );
  if (declared) {
    return { level: "autoAllow", reason: "declared validation command" };
  }

  if (
    (first === "git" && /status|log|diff|show|rev-parse|worktree list/.test(joined)) ||
    /^(rg|grep|find|ls|cat|sed|head|tail)\b/.test(joined)
  ) {
    return { level: "autoAllow", reason: "read/search/git history inside worktree" };
  }

  if (!isInside(context.worktreeRoot, request.cwd)) {
    return { level: "deny", reason: "command working directory is outside worktree" };
  }

  if (
    /^(npm|pnpm|yarn)\s+(install|add)\b/.test(joined) ||
    /^(pip|pip3)\s+install\b/.test(joined) ||
    /^(cargo|go)\s+(add|install)\b/.test(joined)
  ) {
    return { level: "prompt", reason: "dependency install/upgrade" };
  }

  if (
    first === "curl" ||
    first === "wget" ||
    /^(npm\s+publish|git\s+fetch|git\s+clone)\b/.test(joined)
  ) {
    return { level: "prompt", reason: "network access" };
  }

  return { level: "prompt", reason: "command requires manual review" };
}

function classifyFile(
  request: { path: string; action: "read" | "write" | "delete" },
  context: PolicyContext,
): PolicyDecision {
  if (!isAbsolute(request.path)) {
    return { level: "deny", reason: "file path is not absolute" };
  }

  if (!isInside(context.worktreeRoot, request.path)) {
    return { level: "deny", reason: "path is outside worktree" };
  }

  if (request.action === "read") {
    return { level: "autoAllow", reason: "read inside worktree" };
  }

  if (request.action === "delete") {
    return { level: "prompt", reason: "file deletion" };
  }

  const forbidden = context.forbiddenPaths.some((root) =>
    isInside(root, request.path),
  );
  if (forbidden) {
    return { level: "deny", reason: "path is explicitly forbidden" };
  }

  const planned = context.plannedPaths.includes(resolve(request.path));
  if (planned) {
    return { level: "autoAllow", reason: "planned file change inside allowed scope" };
  }

  return { level: "prompt", reason: "file change is outside planned scope" };
}

export function classifyApprovalRequest(
  request: ApprovalRequest,
  context: PolicyContext,
): PolicyDecision {
  if (request.kind === "command") {
    return classifyCommand(request, context);
  }
  if (request.kind === "file") {
    return classifyFile(request, context);
  }
  if (request.kind === "network") {
    return { level: "prompt", reason: "network access" };
  }
  if (request.kind === "permissions") {
    return { level: "prompt", reason: "permission grant request" };
  }
  return { level: "deny", reason: "unknown approval request" };
}
