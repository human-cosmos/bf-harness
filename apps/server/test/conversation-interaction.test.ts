import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { ConversationRepository } from "../src/repositories/conversation-repository.js";
import { ConversationApprovalRepository } from "../src/repositories/conversation-approval-repository.js";
import { ConversationClarificationRepository } from "../src/repositories/conversation-clarification-repository.js";
import { ConversationInteractionCoordinator } from "../src/services/conversation-interaction-coordinator.js";
import { DynamicToolRegistry } from "../src/services/dynamic-tool-registry.js";
import { EventBus } from "../src/services/event-bus.js";
import { DEFAULT_CONVERSATION_POLICY } from "@bugfix-harness/shared";

function createConversationId(db: ReturnType<typeof openDatabase>): string {
  const project = new ProjectRepository(db).create({
    name: "demo",
    repoPath: "/tmp/demo",
    instructionSources: [],
    validationCommands: [],
    allowedPaths: [],
    forbiddenPaths: [],
  });
  return new ConversationRepository(db).create({
    projectId: project.id,
    title: "测试对话",
  }).id;
}

describe("ConversationInteractionCoordinator", () => {
  it("waits for command approval and returns the chosen decision", async () => {
    const db = openDatabase(":memory:");
    const conversationId = createConversationId(db);
    const coordinator = new ConversationInteractionCoordinator(
      conversationId,
      new ConversationApprovalRepository(db),
      new ConversationClarificationRepository(db),
      new EventBus(),
      DEFAULT_CONVERSATION_POLICY,
      new DynamicToolRegistry(tmpdir()),
    );

    const responsePromise = coordinator.handleServerRequest({
      method: "item/commandExecution/requestApproval",
      id: 7,
      params: { command: "npm test", kind: "command" },
    });

    const approvals = new ConversationApprovalRepository(db);
    const approval = approvals.listByConversation(conversationId)[0];
    expect(approval.kind).toBe("command");
    coordinator.decideApproval(approval.id, "accept");

    await expect(responsePromise).resolves.toEqual({ decision: "accept" });
  });

  it("returns empty permissions when a permission request is declined", async () => {
    const db = openDatabase(":memory:");
    const conversationId = createConversationId(db);
    const coordinator = new ConversationInteractionCoordinator(
      conversationId,
      new ConversationApprovalRepository(db),
      new ConversationClarificationRepository(db),
      new EventBus(),
      DEFAULT_CONVERSATION_POLICY,
      new DynamicToolRegistry(tmpdir()),
    );

    const responsePromise = coordinator.handleServerRequest({
      method: "item/permissions/requestApproval",
      id: 8,
      params: { permissions: { network: { enabled: true } } },
    });

    const approval = new ConversationApprovalRepository(db).listByConversation(
      conversationId,
    )[0];
    coordinator.decideApproval(approval.id, "decline");

    await expect(responsePromise).resolves.toEqual({
      permissions: {},
      scope: "turn",
    });
  });

  it("resolves clarification answers", async () => {
    const db = openDatabase(":memory:");
    const conversationId = createConversationId(db);
    const coordinator = new ConversationInteractionCoordinator(
      conversationId,
      new ConversationApprovalRepository(db),
      new ConversationClarificationRepository(db),
      new EventBus(),
      DEFAULT_CONVERSATION_POLICY,
      new DynamicToolRegistry(tmpdir()),
    );

    const responsePromise = coordinator.handleServerRequest({
      method: "item/tool/requestUserInput",
      id: 9,
      params: {
        questions: [{ id: "q1", header: "确认", question: "继续吗？" }],
      },
    });

    const clarification = new ConversationClarificationRepository(
      db,
    ).getPendingByConversation(conversationId);
    expect(clarification).toBeDefined();
    coordinator.answerClarification(clarification!.id, {
      q1: { answers: ["继续"] },
    });

    await expect(responsePromise).resolves.toEqual({
      answers: { q1: { answers: ["继续"] } },
    });
  });

  it("executes safe dynamic file tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-tool-"));
    writeFileSync(join(root, "hello.txt"), "hello");
    const registry = new DynamicToolRegistry(root);
    const result = await registry.call({
      tool: "fs/readFile",
      arguments: { path: "hello.txt" },
    });
    expect(result.success).toBe(true);
    expect(result.contentItems[0].text).toBe("hello");
  });

  it("times out an unanswered approval request and marks it cancelled", async () => {
    const db = openDatabase(":memory:");
    const conversationId = createConversationId(db);
    const coordinator = new ConversationInteractionCoordinator(
      conversationId,
      new ConversationApprovalRepository(db),
      new ConversationClarificationRepository(db),
      new EventBus(),
      DEFAULT_CONVERSATION_POLICY,
      new DynamicToolRegistry(tmpdir()),
      20,
    );

    await expect(
      coordinator.handleServerRequest({
        method: "item/commandExecution/requestApproval",
        id: 20,
        params: { command: "npm test", kind: "command" },
      }),
    ).resolves.toEqual({ decision: "cancel" });

    const stored = new ConversationApprovalRepository(db).listByConversation(
      conversationId,
    )[0];
    expect(stored.decision).toBe("cancel");
  });

  it("rejects symlink paths that escape the project root", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-tool-root-"));
    const outside = mkdtempSync(join(tmpdir(), "conversation-tool-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

    const registry = new DynamicToolRegistry(root);
    const result = await registry.call({
      tool: "fs/readFile",
      arguments: { path: "link.txt" },
    });
    expect(result.success).toBe(false);
    expect(result.contentItems[0].text).toContain("escapes");
  });
});
