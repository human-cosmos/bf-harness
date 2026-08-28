import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { AgentEventRepository } from "../src/repositories/agent-event-repository.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { RetentionExecutor } from "../src/services/retention-executor.js";

describe("RetentionExecutor", () => {
  it("keeps the most recent task events", () => {
    const db = openDatabase(":memory:");
    const projects = new ProjectRepository(db);
    const tasks = new TaskRepository(db);
    const events = new AgentEventRepository(db);
    const project = projects.create({
      name: "demo",
      repoPath: "/tmp/demo",
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const task = tasks.create({
      projectId: project.id,
      title: "fix",
      bugDescription: "broken",
      observedBehavior: "error",
      expectedBehavior: "works",
      relatedFiles: [],
      acceptanceCriteria: [],
      constraints: [],
    });

    for (let seq = 1; seq <= 12; seq += 1) {
      events.append({
        taskId: task.id,
        method: "item/agentMessage/delta",
        payload: { seq },
        seq,
      });
    }

    const executor = new RetentionExecutor(events, 10);
    expect(executor.pruneTaskEvents(task.id)).toBe(2);
    expect(events.countByTask(task.id)).toBe(10);
    expect(events.listByTask(task.id, { limit: 1 })[0].seq).toBe(3);
  });
});
