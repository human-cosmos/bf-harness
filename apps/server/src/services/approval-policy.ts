import { isAbsolute, join, relative, resolve } from "node:path";

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
  | { kind: "permissions"; reason?: string; permissions?: unknown };

export function makePolicyContext(input: {
  worktreeRoot: string;
  repoRoot?: string;
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  plannedPaths?: string[];
  declaredValidationCommands?: ValidationCommandEntry[];
}): PolicyContext {
  const worktreeRoot = resolve(input.worktreeRoot);
  const repoRoot = input.repoRoot ? resolve(input.repoRoot) : undefined;

  const mapScopePath = (path: string): string => {
    const trimmed = path.trim();
    if (isAbsolute(trimmed)) {
      const absolute = resolve(trimmed);
      if (repoRoot && isInside(repoRoot, absolute)) {
        return join(worktreeRoot, relative(repoRoot, absolute));
      }
      return absolute;
    }
    return resolve(worktreeRoot, trimmed);
  };

  return {
    worktreeRoot,
    allowedPaths: (input.allowedPaths ?? []).map(mapScopePath),
    forbiddenPaths: (input.forbiddenPaths ?? []).map(mapScopePath),
    plannedPaths: (input.plannedPaths ?? []).map(mapScopePath),
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
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isSafeReadCommand(
  tokens: string[],
  joined: string,
  first: string,
  cwd: string,
  context: PolicyContext,
): boolean {
  if (!isInside(context.worktreeRoot, cwd)) {
    return false;
  }

  if (
    tokens.some(
      (token) => isAbsolute(token) && !isInside(context.worktreeRoot, token),
    )
  ) {
    return false;
  }

  if (
    first === "sed" &&
    tokens.some(
      (token) =>
        token.startsWith("--in-place") ||
        (/^-[^-]/.test(token) && token.includes("i")),
    )
  ) {
    return false;
  }

  if (
    first === "find" &&
    tokens.some(
      (token) => token === "-delete" || token === "-exec" || token === "-execdir",
    )
  ) {
    return false;
  }

  if (
    first === "git" &&
    /status|log|diff|show|rev-parse|worktree list/.test(joined)
  ) {
    return true;
  }

  return /^(rg|grep|find|ls|cat|sed|head|tail)\b/.test(joined);
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

  if (isSafeReadCommand(tokens, joined, first, request.cwd, context)) {
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

  const target = resolve(request.path);
  if (!isInside(context.worktreeRoot, target)) {
    return { level: "deny", reason: "path is outside worktree" };
  }

  if (request.action === "read") {
    return { level: "autoAllow", reason: "read inside worktree" };
  }

  if (request.action === "delete") {
    if (isForbidden(target, context)) {
      return { level: "deny", reason: "path is explicitly forbidden" };
    }
    return { level: "prompt", reason: "file deletion" };
  }

  if (isForbidden(target, context)) {
    return { level: "deny", reason: "path is explicitly forbidden" };
  }

  if (
    context.allowedPaths.length > 0 &&
    context.allowedPaths.some((root) => isInside(root, target))
  ) {
    return { level: "autoAllow", reason: "file change inside allowed scope" };
  }

  const plannedRoots = context.plannedPaths;
  if (plannedRoots.some((root) => isInside(root, target))) {
    return { level: "autoAllow", reason: "planned file change inside allowed scope" };
  }

  return { level: "prompt", reason: "file change is outside planned scope" };
}

function isForbidden(target: string, context: PolicyContext): boolean {
  return context.forbiddenPaths.some((root) => isInside(root, target));
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
