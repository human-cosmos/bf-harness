import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppServerClient } from "../lib/app-server.mjs";
import { makeSpikeScratch, removeScratch, resolveLongPath } from "../lib/paths.mjs";

const tempRoot = makeSpikeScratch("bugfix-harness-v3-");
const repoPath = resolveLongPath(join(tempRoot, "repo"));
const worktreePath = join(tempRoot, "worktree");
const branchName = `harness/v3-${Date.now()}`;
let client;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

try {
  run("git", ["init", repoPath]);
  run("git", ["-C", repoPath, "config", "user.email", "spike@example.com"]);
  run("git", ["-C", repoPath, "config", "user.name", "Spike"]);
  writeFileSync(join(repoPath, "main.txt"), "unchanged\n", "utf8");
  run("git", ["-C", repoPath, "add", "main.txt"]);
  run("git", ["-C", repoPath, "commit", "-m", "baseline"]);

  const baseline = run("git", ["-C", repoPath, "rev-parse", "HEAD"])
    .stdout.trim();
  run("git", [
    "-C",
    repoPath,
    "worktree",
    "add",
    "-b",
    branchName,
    worktreePath,
    baseline,
  ]);

  const resolvedWorktree = resolveLongPath(worktreePath);

  client = new AppServerClient({
    cwd: resolvedWorktree,
    approvalMode: "accept",
    timeoutMs: 120_000,
    log: (label, value) => {
      console.log(`[v3] ${label} ${value === undefined ? "" : JSON.stringify(value)}`);
    },
  }).start();

  await client.initialize({
    name: "bugfix-harness-v3-worktree",
    title: "Bugfix Harness V3",
    version: "0.1.0",
  });

  await client.startThread({
    cwd: resolvedWorktree,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ephemeral: false,
  });

  await client.startTurn({
    threadId: client.currentThreadId,
    input: [
      {
        type: "text",
        text:
          "Create a file named spike.txt in the current working directory with exactly: V3_OK",
      },
    ],
  });

  const completion = await client.waitForTurnCompletion();
  console.log("[v3] turn-status", completion.turn?.status);

  const spikeFile = join(resolvedWorktree, "spike.txt");
  const worktreeCreated = existsSync(spikeFile);
  const originalUntouched = !existsSync(join(repoPath, "spike.txt"));
  const originalClean =
    run("git", ["-C", repoPath, "status", "--porcelain"]).stdout.trim() === "";
  const diffResult = spawnSync(
    "git",
    ["-C", resolvedWorktree, "diff", "--no-index", "--", "/dev/null", "spike.txt"],
    { encoding: "utf8" },
  );
  const diff = diffResult.stdout || diffResult.stderr || "";
  const fileContent = worktreeCreated
    ? readFileSync(spikeFile, "utf8").trim()
    : "";

  console.log("[v3] evidence", {
    worktreeCreated,
    fileContent,
    originalUntouched,
    originalClean,
    diffLines: diff.split("\n").filter(Boolean).length,
  });

  if (
    worktreeCreated &&
    fileContent.includes("V3_OK") &&
    originalUntouched &&
    originalClean &&
    diff.length > 0
  ) {
    console.log("[v3] PASS");
  } else {
    console.error("[v3] FAILED");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[v3] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  removeScratch(tempRoot);
}
