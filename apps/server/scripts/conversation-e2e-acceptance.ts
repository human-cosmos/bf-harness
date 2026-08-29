import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.js";
import { BugfixService } from "../src/services/bugfix-service.js";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const root = mkdtempSync(join(tmpdir(), "bugfix-harness-conversation-e2e-"));
const repo = join(root, "repo");
const worktreeRoot = join(root, "worktrees");

try {
  git(["init", repo]);
  git(["-C", repo, "config", "user.email", "conversation-e2e@example.com"]);
  git(["-C", repo, "config", "user.name", "Conversation E2E"]);
  writeFileSync(join(repo, "README.md"), "# conversation e2e\n");
  git(["-C", repo, "add", "README.md"]);
  git(["-C", repo, "commit", "-m", "baseline"]);

  const db = openDatabase(":memory:");
  const service = new BugfixService({ db, worktreeRoot });
  const project = await service.createProject({
    name: "conversation-e2e",
    repoPath: repo,
    instructionSources: [],
    validationCommands: [],
    allowedPaths: [repo],
    forbiddenPaths: [],
  });
  const conversation = await service.conversationService.createConversation({
    projectId: project.id,
    title: "端到端对话",
  });
  const result = await service.conversationService.sendMessage(conversation.id, {
    text: "Reply with exactly CONVERSATION_E2E_OK",
    mentions: [],
  });

  const items = service.conversationService.listItems(conversation.id);
  const events = service.conversationService.listEvents(conversation.id);
  const finalConversation = service.conversationService.getConversation(
    conversation.id,
  );
  const agentItems = items.filter((item) => item.itemType === "agentMessage");

  if (!finalConversation?.codexThreadId) {
    throw new Error("Conversation did not persist a Codex thread id");
  }
  if (agentItems.length === 0) {
    throw new Error("No agent message item was captured");
  }
  if (events.length === 0) {
    throw new Error("No conversation events were captured");
  }

  await service.conversationService.interruptConversation(conversation.id);

  console.log("CONVERSATION_E2E_OK", {
    conversationId: conversation.id,
    turnId: result.turnId,
    threadId: finalConversation.codexThreadId,
    agentItems: agentItems.length,
    events: events.length,
  });
} catch (error) {
  console.error("CONVERSATION_E2E_FAILED", error);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
