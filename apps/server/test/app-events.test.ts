import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";

describe("task events endpoint", () => {
  it("rejects non-numeric or out-of-range pagination parameters", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-app-events-"));
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const app = await buildApp(service);

    try {
      const badLimit = await app.inject({
        method: "GET",
        url: "/api/tasks/00000000-0000-4000-8000-000000000000/events?limit=abc",
      });
      expect(badLimit.statusCode).toBe(400);

      const badAfterSeq = await app.inject({
        method: "GET",
        url: "/api/tasks/00000000-0000-4000-8000-000000000000/events?afterSeq=-1",
      });
      expect(badAfterSeq.statusCode).toBe(400);
    } finally {
      await app.close();
      rmSync(worktreeRoot, { recursive: true, force: true });
      db.close();
    }
  });
});
