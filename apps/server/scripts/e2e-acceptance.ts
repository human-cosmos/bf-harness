import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { resolveLongPath } from "../src/services/fs-paths.js";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const scratchRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.tmp-e2e",
);
mkdirSync(scratchRoot, { recursive: true });
const root = resolveLongPath(mkdtempSync(join(scratchRoot, "run-")));
const repo = join(root, "repo");
const worktreeRoot = join(root, "worktrees");

try {
  git(["init", repo]);
  git(["-C", repo, "config", "user.email", "e2e@example.com"]);
  git(["-C", repo, "config", "user.name", "E2E"]);
  writeFileSync(join(repo, "app.txt"), "hello\n");
  git(["-C", repo, "add", "app.txt"]);
  git(["-C", repo, "commit", "-m", "baseline"]);

  const db = openDatabase(":memory:");
  const service = new BugfixService({ db, worktreeRoot });
  const project = await service.createProject({
    name: "e2e",
    repoPath: repo,
    instructionSources: [],
    validationCommands: [
      { id: "echo", label: "Echo", command: ["node", "-e", "console.log('accepted')"], timeoutSec: 30 },
    ],
    allowedPaths: [repo],
    forbiddenPaths: [],
  });
  const created = await service.createTask({
    projectId: project.id,
    title: "Add a result file",
    bugDescription: "The project lacks result.txt.",
    observedBehavior: "result.txt is missing.",
    expectedBehavior: "result.txt exists with E2E_OK.",
    relatedFiles: [],
    acceptanceCriteria: ["result.txt contains E2E_OK"],
    constraints: [],
  });

  const plan = await service.agent.analyze(created.task.id);
  await service.workflow.approvePlan(created.task.id, "approved by e2e");
  const output = await service.agent.implement(created.task.id);
  const validations = await service.execution.runValidations(created.task.id);
  const report = await service.execution.buildReport(created.task.id);
  await service.workflow.transitionTask(created.task.id, "ACCEPTED");

  console.log("E2E_ACCEPTANCE_OK", {
    taskId: created.task.id,
    planFiles: plan.proposedFiles,
    agentOutput: output,
    validations: validations.map((item) => item.status),
    reportId: report.id,
    finalStatus: service.tasks.get(created.task.id)?.status,
  });
} catch (error) {
  const message =
    error instanceof Error
      ? error.stack ?? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error, Object.getOwnPropertyNames(error as object));
  console.error("E2E_ACCEPTANCE_FAILED", message);
  process.exitCode = 1;
} finally {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    console.warn("E2E cleanup skipped:", (error as Error).message);
  }
}
