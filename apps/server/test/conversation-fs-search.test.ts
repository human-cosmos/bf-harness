import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { ProjectRepository } from "../src/repositories/project-repository.js";
import { buildApp } from "../src/app.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";

describe("conversation file search", () => {
  it("returns project files matching the query", async () => {
    const root = mkdtempSync(join(tmpdir(), "conversation-search-"));
    writeFileSync(join(root, "app.ts"), "export default 1");
    writeFileSync(join(root, "README.md"), "readme");

    const db = openDatabase(":memory:");
    const project = new ProjectRepository(db).create({
      name: "demo",
      repoPath: root,
      instructionSources: [],
      validationCommands: [],
      allowedPaths: [],
      forbiddenPaths: [],
    });
    const service = new BugfixService({
      db,
      worktreeRoot: join(root, "worktrees"),
      eventBus: new EventBus(),
    });
    const app = await buildApp(service);

    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${project.id}/fs/search?query=app`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.contentItems[0].text).toContain("app.ts");
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
      db.close();
    }
  });
});
