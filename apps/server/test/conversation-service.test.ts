import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { ConversationService } from "../src/services/conversation-service.js";
import type { ConversationRuntimeManager } from "../src/services/conversation-runtime-manager.js";
import type { AppServerRuntime } from "../src/services/app-server-runtime.js";

class FakeRuntime extends EventEmitter {
  currentThreadId = "thread-1";
  currentTurnId: string | null = null;
  onServerRequest: ((message: unknown) => Promise<unknown | undefined>) | null =
    null;

  async startTurn() {
    this.currentTurnId = "turn-1";
    this.emit("notification", {
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1" } },
    });
    return { turn: { id: "turn-1" } };
  }

  async waitForTurnCompletion() {
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "hello",
      },
    });
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
    });
    return { turn: { id: "turn-1", status: "completed" } };
  }
}

function createService() {
  const db = openDatabase(":memory:");
  const projects = new ProjectRepository(db);
  const project = projects.create({
    name: "demo",
    repoPath: "/tmp/demo",
    instructionSources: [],
    validationCommands: [],
    allowedPaths: [],
    forbiddenPaths: [],
  });

  const fakeRuntime = new FakeRuntime();
  const runtimeManager = {
    get: () => undefined,
    getOrCreate: async () => fakeRuntime as unknown as AppServerRuntime,
    interrupt: async () => {},
    close: () => {},
    closeAll: () => {},
    listActiveConversationIds: () => [],
  } as unknown as ConversationRuntimeManager;

  const service = new ConversationService({
    db,
    projects,
    runtimeManager,
  });
  return { service, project, fakeRuntime };
}

describe("ConversationService", () => {
  it("creates, lists and updates conversations", async () => {
    const { service, project } = createService();
    const conversation = await service.createConversation({
      projectId: project.id,
      title: "探索代码",
    });

    expect(service.listConversations(project.id)).toHaveLength(1);
    expect(service.getConversation(conversation.id)?.status).toBe("IDLE");

    const updated = service.updateConversation(conversation.id, {
      title: "新标题",
    });
    expect(updated.title).toBe("新标题");
  });

  it("persists a user message and turn events when sending a message", async () => {
    const { service, project } = createService();
    const conversation = await service.createConversation({
      projectId: project.id,
      title: "聊天",
    });

    const result = await service.sendMessage(conversation.id, {
      text: "你好",
      mentions: [{ name: "app.ts", path: "/tmp/demo/app.ts" }],
    });

    expect(result.turnId).toBe("turn-1");
    const items = service.listItems(conversation.id);
    expect(items.map((item) => item.itemType)).toContain("userMessage");
    expect(items.map((item) => item.itemType)).toContain("agentMessage");
    expect(service.listEvents(conversation.id).length).toBeGreaterThan(0);
    expect(service.getConversation(conversation.id)?.codexThreadId).toBe(
      "thread-1",
    );
  });

  it("deletes a conversation", async () => {
    const { service, project } = createService();
    const conversation = await service.createConversation({
      projectId: project.id,
      title: "待删除",
    });

    await expect(service.deleteConversation(conversation.id)).resolves.toEqual({
      deleted: true,
    });
  });
});
