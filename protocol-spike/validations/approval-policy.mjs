import { isAbsolute, join, relative, resolve } from "node:path";

function isInside(root, target) {
  if (!isAbsolute(root) || !isAbsolute(target)) {
    return false;
  }
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function commandTokens(command) {
  return String(command || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function classifyCommand({ command, cwd }, context) {
  const tokens = commandTokens(command);
  const first = tokens[0]?.toLowerCase();
  const joined = tokens.join(" ").toLowerCase();

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

  if (
    (first === "git" && /status|log|diff|show|rev-parse|worktree list/.test(joined)) ||
    /^(rg|grep|find|ls|cat|sed -n|head|tail)\b/.test(joined)
  ) {
    return { level: "autoAllow", reason: "read/search/git history inside worktree" };
  }

  const declared = context.declaredValidationCommands ?? [];
  if (declared.some((entry) => joinTokens(entry.command ?? entry) === joinTokens(tokens))) {
    return { level: "autoAllow", reason: "declared validation command" };
  }

  if (
    /^(npm|pnpm|yarn)\s+(install|add)\b/.test(joined) ||
    /^(pip|pip3)\s+install\b/.test(joined) ||
    /^(cargo|go)\s+(add|install)\b/.test(joined)
  ) {
    return { level: "prompt", reason: "dependency install/upgrade" };
  }

  if (
    /^(curl|wget|npm\s+publish|git\s+fetch|git\s+clone)\b/.test(joined) ||
    first === "curl" ||
    first === "wget"
  ) {
    return { level: "prompt", reason: "network access" };
  }

  const outsideWorktree =
    cwd && isAbsolute(cwd) ? !isInside(context.worktreeRoot, cwd) : true;
  if (outsideWorktree) {
    return { level: "deny", reason: "command working directory is outside worktree" };
  }

  return { level: "prompt", reason: "command requires manual review" };
}

function classifyFile({ path: targetPath, action }, context) {
  if (!isAbsolute(targetPath)) {
    return { level: "deny", reason: "file path is not absolute" };
  }

  if (!isInside(context.worktreeRoot, targetPath)) {
    return { level: "deny", reason: "path is outside worktree" };
  }

  if (action === "read") {
    return { level: "autoAllow", reason: "read inside worktree" };
  }

  if (action === "delete") {
    return { level: "prompt", reason: "file deletion" };
  }

  if (action !== "write") {
    return { level: "prompt", reason: "unknown file action" };
  }

  const planned = context.plannedPaths ?? context.allowedPaths ?? [];
  if (planned.some((entry) => targetPath === resolve(entry))) {
    return { level: "autoAllow", reason: "planned file change inside allowed scope" };
  }

  const forbidden = context.forbiddenPaths ?? [];
  if (forbidden.some((entry) => isInside(resolve(entry), targetPath))) {
    return { level: "deny", reason: "path is explicitly forbidden" };
  }

  return { level: "prompt", reason: "file change is outside planned scope" };
}

function joinTokens(value) {
  return Array.isArray(value) ? value.join(" ") : String(value);
}

export function classifyApprovalRequest(request, context) {
  if (request.kind === "file") {
    return classifyFile(request, context);
  }
  if (request.kind === "command") {
    return classifyCommand(request, context);
  }
  if (request.kind === "network") {
    return { level: "prompt", reason: "network access" };
  }
  if (request.kind === "permissions") {
    return { level: "prompt", reason: "permission grant request" };
  }
  return { level: "deny", reason: "unknown approval request" };
}

export function makePolicyContext({
  worktreeRoot,
  allowedPaths = [],
  forbiddenPaths = [],
  plannedPaths = [],
  declaredValidationCommands = [],
}) {
  return {
    worktreeRoot: resolve(worktreeRoot),
    allowedPaths: allowedPaths.map((path) => resolve(path)),
    forbiddenPaths: forbiddenPaths.map((path) => resolve(path)),
    plannedPaths: plannedPaths.map((path) => resolve(path)),
    declaredValidationCommands,
  };
}
