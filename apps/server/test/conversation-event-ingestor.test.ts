import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { ConversationRepository } from "../src/repositories/conversation-repository.js";
import { ConversationEventRepository } from "../src/repositories/conversation-event-repository.js";
import { ConversationItemRepository } from "../src/repositories/conversation-item-repository.js";
import { ConversationEventIngestor } from "../src/services/conversation-event-ingestor.js";
import type { AppServerRuntime } from "../src/services/app-server-runtime.js";

function makeRuntime(): AppServerRuntime {
  return new EventEmitter() as AppServerRuntime;
}

describe("ConversationEventIngestor", () => {
  it("persists raw events and normalizes command/reasoning items", () => {
    const db = openDatabase(":memory:");
    const project = new ProjectRepository(db).create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const conversation = new ConversationRepository(db).create({
      projectId: project.id,
      title: "测试对话",
    });
    const events = new ConversationEventRepository(db);
    const items = new ConversationItemRepository(db);
    const runtime = makeRuntime();
    (runtime as AppServerRuntime).currentThreadId = "thread-1";
    (runtime as AppServerRuntime).currentTurnId = "turn-1";

    const ingestor = new ConversationEventIngestor(
      events,
      items,
      conversation.id,
    );
    const detach = ingestor.attach(runtime);

    runtime.emit("notification", {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "PASS",
      },
    });
    runtime.emit("notification", {
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        delta: "thinking",
      },
    });

    expect(events.listByConversation(conversation.id)).toHaveLength(2);
    const storedItems = items.listByConversation(conversation.id);
    expect(storedItems).toHaveLength(2);
    expect(storedItems.map((item) => item.itemType)).toEqual([
      "commandExecution",
      "reasoning",
    ]);
    detach();
  });

  it("tracks item lifecycle using item.id from lifecycle notifications", () => {
    const db = openDatabase(":memory:");
    const project = new ProjectRepository(db).create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const conversation = new ConversationRepository(db).create({
      projectId: project.id,
      title: "测试对话",
    });
    const events = new ConversationEventRepository(db);
    const items = new ConversationItemRepository(db);
    const runtime = makeRuntime();
    (runtime as AppServerRuntime).currentThreadId = "thread-1";
    (runtime as AppServerRuntime).currentTurnId = "turn-1";

    const ingestor = new ConversationEventIngestor(
      events,
      items,
      conversation.id,
    );
    const detach = ingestor.attach(runtime);

    runtime.emit("notification", {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "item-lifecycle", type: "commandExecution" },
      },
    });
    runtime.emit("notification", {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "item-lifecycle",
          type: "commandExecution",
          status: "completed",
        },
      },
    });

    const stored = items.listByConversation(conversation.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].codexItemId).toBe("item-lifecycle");
    expect(stored[0].status).toBe("completed");
    detach();
  });

  it("does not persist a Codex user message that duplicates the local copy", () => {
    const db = openDatabase(":memory:");
    const project = new ProjectRepository(db).create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const conversation = new ConversationRepository(db).create({
      projectId: project.id,
      title: "测试对话",
    });
    const events = new ConversationEventRepository(db);
    const items = new ConversationItemRepository(db);

    items.create({
      conversationId: conversation.id,
      itemType: "userMessage",
      role: "user",
      payload: {
        text: "你好",
        mentions: [{ name: "app.ts", path: "/tmp/demo/app.ts" }],
      },
    });

    const runtime = makeRuntime();
    (runtime as AppServerRuntime).currentThreadId = "thread-1";
    (runtime as AppServerRuntime).currentTurnId = "turn-1";
    const ingestor = new ConversationEventIngestor(
      events,
      items,
      conversation.id,
    );
    const detach = ingestor.attach(runtime);

    runtime.emit("notification", {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "codex-user-item",
        item: {
          id: "codex-user-item",
          type: "userMessage",
          content: [
            { type: "text", text: "你好", text_elements: [] },
            { type: "mention", name: "app.ts", path: "/tmp/demo/app.ts" },
          ],
        },
      },
    });

    const stored = items.listByConversation(conversation.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].itemType).toBe("userMessage");
    expect(stored[0].codexItemId).toBeNull();
    detach();
  });
});
