import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { ConversationRepository } from "../src/repositories/conversation-repository.js";
import { ConversationTurnRepository } from "../src/repositories/conversation-turn-repository.js";
import { ConversationItemRepository } from "../src/repositories/conversation-item-repository.js";
import { ConversationEventRepository } from "../src/repositories/conversation-event-repository.js";
import { ConversationApprovalRepository } from "../src/repositories/conversation-approval-repository.js";
import { ConversationClarificationRepository } from "../src/repositories/conversation-clarification-repository.js";

function createProject(db: ReturnType<typeof openDatabase>) {
  return new ProjectRepository(db).create({
    name: "demo",
    repoPath: "/tmp/demo",
    instructionSources: [],
    validationCommands: [],
    allowedPaths: [],
    forbiddenPaths: [],
  });
}

describe("conversation repositories", () => {
  it("persists conversations with safe defaults", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db);
    const conversations = new ConversationRepository(db);

    const conversation = conversations.create({
      projectId: project.id,
      title: "初始对话",
    });

    expect(conversation.status).toBe("IDLE");
    expect(conversation.policy.sandboxMode).toBe("workspace-write");
    expect(conversations.list(project.id)).toHaveLength(1);
  });

  it("updates conversation fields and thread id", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db);
    const conversations = new ConversationRepository(db);
    const conversation = conversations.create({
      projectId: project.id,
      title: "初始对话",
    });

    const updated = conversations.update(conversation.id, {
      title: "新标题",
      policy: {
        sandboxMode: "danger-full-access",
        networkAccess: true,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        allowGitWrites: true,
      },
    });

    expect(updated?.title).toBe("新标题");
    expect(updated?.policy.sandboxMode).toBe("danger-full-access");

    conversations.updateThreadId(conversation.id, "thread-1");
    expect(conversations.get(conversation.id)?.codexThreadId).toBe("thread-1");
  });

  it("persists turns, items, events, approvals and clarifications", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db);
    const conversations = new ConversationRepository(db);
    const turns = new ConversationTurnRepository(db);
    const items = new ConversationItemRepository(db);
    const events = new ConversationEventRepository(db);
    const approvals = new ConversationApprovalRepository(db);
    const clarifications = new ConversationClarificationRepository(db);

    const conversation = conversations.create({
      projectId: project.id,
      title: "对话",
    });

    const turn = turns.create({
      conversationId: conversation.id,
      codexTurnId: "turn-1",
      startedAtMs: Date.now(),
    });
    turns.update(turn.id, {
      status: "COMPLETED",
      completedAtMs: Date.now(),
      durationMs: 120,
    });

    const item = items.create({
      conversationId: conversation.id,
      codexTurnId: turn.codexTurnId,
      codexItemId: "item-1",
      itemType: "agentMessage",
      role: "assistant",
      payload: { text: "hello" },
    });
    expect(items.listByConversation(conversation.id)).toHaveLength(1);

    const event = events.append({
      conversationId: conversation.id,
      codexTurnId: turn.codexTurnId,
      kind: "agent.message.delta",
      method: "item/agentMessage/delta",
      payload: { delta: "hello" },
      dedupeKey: "turn-1:item-1:0",
    });
    expect(event.seq).toBe(1);
    expect(events.listByConversation(conversation.id)).toHaveLength(1);

    const approval = approvals.create({
      conversationId: conversation.id,
      codexRequestId: 7,
      method: "item/commandExecution/requestApproval",
      kind: "command",
      payload: { command: "npm test" },
      riskLevel: "prompt",
    });
    approvals.decide(approval.id, "accept");
    expect(approvals.listByConversation(conversation.id)[0].decision).toBe(
      "accept",
    );

    const clarification = clarifications.create({
      conversationId: conversation.id,
      codexRequestId: 8,
      codexTurnId: turn.codexTurnId,
      questions: [{ id: "q1", header: "问题", question: "为什么？" }],
    });
    clarifications.answer(clarification.id, { q1: { answers: ["因为"] } });
    expect(
      clarifications.getPendingByConversation(conversation.id),
    ).toBeUndefined();

    expect(items.get(item.id)?.status).toBeNull();
  });

  it("deletes conversation and all children", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db);
    const conversations = new ConversationRepository(db);
    const events = new ConversationEventRepository(db);
    const conversation = conversations.create({
      projectId: project.id,
      title: "对话",
    });
    events.append({
      conversationId: conversation.id,
      method: "turn/started",
      kind: "turn.started",
      payload: {},
    });

    expect(conversations.delete(conversation.id)).toBe(true);
    expect(events.countByConversation(conversation.id)).toBe(0);
    expect(conversations.get(conversation.id)).toBeUndefined();
  });
});
