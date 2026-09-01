import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_SETTINGS } from "@bugfix-harness/shared";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";
import { SystemSettingsService } from "../src/services/system-settings-service.js";
import { SystemSettingsRepository } from "../src/repositories/system-settings-repository.js";
import type { SystemSettings } from "@bugfix-harness/shared";

async function createApp() {
  const db = openDatabase(":memory:");
  const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-system-settings-"));
  const service = new BugfixService({
    db,
    worktreeRoot,
    eventBus: new EventBus(),
  });
  const app = await buildApp(service);
  return { app, db, worktreeRoot, service };
}

async function closeApp(input: Awaited<ReturnType<typeof createApp>>) {
  await input.app.close();
  input.db.close();
  rmSync(input.worktreeRoot, { recursive: true, force: true });
}

describe("system settings", () => {
  it("returns defaults when nothing has been saved", async () => {
    const fixture = await createApp();
    try {
      const response = await fixture.app.inject({
        method: "GET",
        url: "/api/settings",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        settings: DEFAULT_SYSTEM_SETTINGS,
        defaults: DEFAULT_SYSTEM_SETTINGS,
      });
    } finally {
      await closeApp(fixture);
    }
  });

  it("saves, reads back, and resets settings", async () => {
    const fixture = await createApp();
    try {
      const updated = {
        ...DEFAULT_SYSTEM_SETTINGS,
        agent: {
          ...DEFAULT_SYSTEM_SETTINGS.agent,
          analysisIdleTimeoutMs: 120_000,
        },
        models: {
          ...DEFAULT_SYSTEM_SETTINGS.models,
          bugfixModel: "custom-model",
        },
        storage: {
          ...DEFAULT_SYSTEM_SETTINGS.storage,
          autoRepairRounds: 1,
        },
      };

      const saveResponse = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ settings: updated }),
      });
      expect(saveResponse.statusCode).toBe(200);
      expect(
        (saveResponse.json() as { settings: typeof updated }).settings,
      ).toEqual(updated);

      const getResponse = await fixture.app.inject({
        method: "GET",
        url: "/api/settings",
      });
      expect(
        (getResponse.json() as { settings: typeof updated }).settings,
      ).toEqual(updated);

      const resetResponse = await fixture.app.inject({
        method: "POST",
        url: "/api/settings/reset",
      });
      expect(resetResponse.statusCode).toBe(200);
      expect(resetResponse.json()).toEqual({
        settings: DEFAULT_SYSTEM_SETTINGS,
        defaults: DEFAULT_SYSTEM_SETTINGS,
      });
    } finally {
      await closeApp(fixture);
    }
  });

  it("rejects invalid settings payloads", async () => {
    const fixture = await createApp();
    try {
      const response = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          settings: {
            ...DEFAULT_SYSTEM_SETTINGS,
            storage: {
              ...DEFAULT_SYSTEM_SETTINGS.storage,
              diskWarnRatio: 1.5,
            },
          },
        }),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: expect.any(String) });
    } finally {
      await closeApp(fixture);
    }
  });
});

describe("system settings service", () => {
  it("persists settings across database reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-settings-reopen-"));
    const dbPath = join(root, "data.sqlite");
    try {
      const first = openDatabase(dbPath);
      const firstService = new SystemSettingsService(first);
      firstService.save({
        ...DEFAULT_SYSTEM_SETTINGS,
        remote: { ...DEFAULT_SYSTEM_SETTINGS.remote, cloneTimeoutMs: 123_456 },
      });
      first.close();

      const second = openDatabase(dbPath);
      const secondService = new SystemSettingsService(second);
      expect(secondService.get().remote.cloneTimeoutMs).toBe(123_456);
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges newly added security fields into previously saved settings", () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-settings-legacy-"));
    const dbPath = join(root, "data.sqlite");
    try {
      const first = openDatabase(dbPath);
      const legacy = {
        ...DEFAULT_SYSTEM_SETTINGS,
        security: {
          conversationDefaults: DEFAULT_SYSTEM_SETTINGS.security.conversationDefaults,
          analyzeApprovalPolicy: "never",
          analyzeApprovalsReviewer: "auto_review",
          implementApprovalPolicy: "never",
          implementApprovalsReviewer: "auto_review",
        },
      };
      new SystemSettingsRepository(first).save(legacy as SystemSettings);
      first.close();

      const second = openDatabase(dbPath);
      const loaded = new SystemSettingsService(second).get();
      expect(loaded.security.bugfixAutomationMode).toBe("auto");
      expect(loaded.security.analyzeApprovalPolicy).toBe("never");
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
