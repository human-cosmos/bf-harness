import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";

describe("conversation API", () => {
  it("creates, reads, updates and deletes a conversation", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "conversation-api-"));
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const project = new ProjectRepository(db).create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const app = await buildApp(service);

    try {
      const createResponse = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/conversations`,
        payload: { title: "探索代码" },
      });
      expect(createResponse.statusCode).toBe(200);
      const conversation = createResponse.json();
      expect(conversation.title).toBe("探索代码");

      const listResponse = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/conversations`,
      });
      expect(listResponse.json()).toHaveLength(1);

      const patchResponse = await app.inject({
        method: "PATCH",
        url: `/api/conversations/${conversation.id}`,
        payload: { title: "新标题" },
      });
      expect(patchResponse.statusCode).toBe(200);
      expect(patchResponse.json().title).toBe("新标题");

      const eventsResponse = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/events`,
      });
      expect(eventsResponse.statusCode).toBe(200);
      expect(Array.isArray(eventsResponse.json())).toBe(true);

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/api/conversations/${conversation.id}`,
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toEqual({ deleted: true });
    } finally {
      await app.close();
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("returns 404 for a missing conversation", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "conversation-api-"));
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const app = await buildApp(service);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/conversations/00000000-0000-4000-8000-000000000000",
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });

  it("rejects invalid conversation pagination parameters", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "conversation-api-"));
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const project = new ProjectRepository(db).create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const conversation = await service.conversationService.createConversation({
      projectId: project.id,
      title: "分页测试",
    });
    const app = await buildApp(service);

    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/conversations/${conversation.id}/events?limit=abc`,
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });
});
