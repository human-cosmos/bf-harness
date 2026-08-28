import { describe, expect, it } from "vitest";
import {
  createBugfixTaskInputSchema,
  createProjectInputSchema,
  createTaskContract,
  normalizeValidationCommands,
} from "../src/index.js";

describe("shared schemas", () => {
  it("accepts a valid project input", () => {
    const input = {
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: ["/tmp/demo/AGENTS.md"],
      validationCommands: [
        { id: "test", label: "Test", command: ["npm", "test"], timeoutSec: 120 },
      ],
      allowedPaths: ["/tmp/demo/src"],
      forbiddenPaths: ["/tmp/demo/secrets"],
    };

    const parsed = createProjectInputSchema.parse(input);
    expect(parsed.name).toBe("demo");
    expect(parsed.validationCommands).toHaveLength(1);
  });

  it("rejects a relative repository path", () => {
    expect(() =>
      createProjectInputSchema.parse({
        name: "bad",
        repoPath: "relative/path",
      }),
    ).toThrow();
  });

  it("creates a task contract from task and project", () => {
    const task = {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      title: "Fix login bug",
      bugDescription: "Login fails",
      observedBehavior: "500 error",
      expectedBehavior: "200 response",
      reproductionSteps: "POST /login",
      relatedFiles: [],
      acceptanceCriteria: ["login returns 200"],
      constraints: ["no dependency upgrade"],
      status: "DRAFT" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const project = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [
        { id: "test", label: "Test", command: ["npm", "test"], timeoutSec: 120 },
      ],
      allowedPaths: ["/tmp/demo/src"],
      forbiddenPaths: ["/tmp/demo/secrets"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const contract = createTaskContract(task, project);
    expect(contract.schemaVersion).toBe("1.0");
    expect(contract.scope.allowedPaths).toEqual(["/tmp/demo/src"]);
    expect(contract.validationCommands).toHaveLength(1);
  });

  it("marks validation commands required by default", () => {
    const commands = normalizeValidationCommands([
      { id: "test", label: "Test", command: ["npm", "test"], timeoutSec: 60 },
    ]);
    expect(commands[0].required).toBe(true);
  });

  it("validates required fields when creating a task", () => {
    expect(() =>
      createBugfixTaskInputSchema.parse({
        projectId: "00000000-0000-4000-8000-000000000002",
        title: "",
        bugDescription: "",
        observedBehavior: "",
        expectedBehavior: "",
      }),
    ).toThrow();
  });

  it("allows an omitted title and uses the bug description as the contract goal", () => {
    const parsed = createBugfixTaskInputSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000002",
      bugDescription: "用户无法登录，页面一直转圈",
    });
    expect(parsed.title).toBe("");

    const task = {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      title: "自动生成标题",
      bugDescription: "用户无法登录，页面一直转圈",
      observedBehavior: "",
      expectedBehavior: "",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
      status: "DRAFT" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const project = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const contract = createTaskContract(task, project);
    expect(contract.goal).toBe("用户无法登录，页面一直转圈");
    expect(contract.observedBehavior).toBe("用户无法登录，页面一直转圈");
    expect(contract.expectedBehavior).toContain("待确认");
  });
});
