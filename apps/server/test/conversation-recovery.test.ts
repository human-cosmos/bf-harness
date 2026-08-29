import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { ConversationService } from "../src/services/conversation-service.js";
import type { ConversationRuntimeManager } from "../src/services/conversation-runtime-manager.js";

describe("conversation recovery", () => {
  it("hydrates turns and items from app-server history", async () => {
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

    const fakeRuntime = {
      currentThreadId: "thread-1",
      listTurns: async () => ({
        turns: [
          {
            id: "turn-1",
            status: "completed",
            startedAt: 1700000000,
            completedAt: 1700000010,
            durationMs: 10000,
          },
        ],
      }),
      listItems: async () => ({
        items: [
          {
            id: "item-1",
            type: "agentMessage",
            role: "assistant",
            text: "恢复成功",
          },
        ],
      }),
    };

    const runtimeManager = {
      getOrCreate: async () => fakeRuntime,
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
    const conversation = await service.createConversation({
      projectId: project.id,
      title: "恢复测试",
    });

    const result = await service.syncConversationHistory(conversation.id);
    expect(result).toEqual({ turns: 1, items: 1 });
    expect(service.listTurns(conversation.id)).toHaveLength(1);
    expect(service.listItems(conversation.id)[0].payload).toMatchObject({
      text: "恢复成功",
    });
  });
});
