import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { ConversationService } from "../src/services/conversation-service.js";

describe("conversation policy", () => {
  it("rejects invalid policy changes", async () => {
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
    const service = new ConversationService({ db, projects });
    const conversation = await service.createConversation({
      projectId: project.id,
      title: "策略测试",
    });

    expect(() =>
      service.updateConversation(conversation.id, {
        policy: { sandboxMode: "invalid" },
      }),
    ).toThrow();
  });

  it("allows full access only when explicitly requested", async () => {
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
    const service = new ConversationService({ db, projects });
    const conversation = await service.createConversation({
      projectId: project.id,
      title: "策略测试",
      policy: {
        sandboxMode: "danger-full-access",
        networkAccess: true,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        allowGitWrites: true,
      },
    });

    expect(conversation.policy.sandboxMode).toBe("danger-full-access");
    expect(conversation.policy.networkAccess).toBe(true);
    expect(conversation.policy.allowGitWrites).toBe(true);
  });
});
