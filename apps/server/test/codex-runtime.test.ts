import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";
import { CodexRuntimeService } from "../src/services/codex-runtime-service.js";
import { SystemSettingsService } from "../src/services/system-settings-service.js";

function createExecutableScript() {
  const dir = mkdtempSync(join(tmpdir(), "bugfix-codex-runtime-"));
  const path = join(dir, "fake-codex");
  writeFileSync(path, "#!/bin/sh\nprintf 'fake-codex 1.0\n'\n", {
    mode: 0o755,
  });
  chmodSync(path, 0o755);
  return { dir, path };
}

describe("CodexRuntimeService", () => {
  it("detects a usable fallback binary", () => {
    const db = openDatabase(":memory:");
    const { dir, path } = createExecutableScript();
    try {
      const settings = new SystemSettingsService(db);
      const runtime = new CodexRuntimeService(settings, path);
      const info = runtime.detect();
      expect(info.available).toBe(true);
      expect(info.codexBin).toBe(path);
      expect(info.source).toBe("fallback");
      expect(info.warning).toBeUndefined();
      expect(info.version).toBe("fake-codex 1.0");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves a manual path and uses it as the explicit source", () => {
    const db = openDatabase(":memory:");
    const { dir, path } = createExecutableScript();
    try {
      const settings = new SystemSettingsService(db);
      const runtime = new CodexRuntimeService(
        settings,
        "/missing/codex",
        "",
        undefined,
      );
      expect(runtime.detect().available).toBe(false);

      const info = runtime.saveManualCodexBin(path);
      expect(info.available).toBe(true);
      expect(info.source).toBe("explicit");
      expect(info.codexBin).toBe(path);
      expect(info.version).toBe("fake-codex 1.0");
      expect(settings.get().runtime.codexBin).toBe(path);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a warning when no binary is usable", () => {
    const db = openDatabase(":memory:");
    try {
      const runtime = new CodexRuntimeService(
        new SystemSettingsService(db),
        "/definitely/missing/codex",
        "",
        undefined,
      );
      const info = runtime.detect();
      expect(info.available).toBe(false);
      expect(info.codexBin).toBeNull();
      expect(info.warning).toContain("未检测到");
    } finally {
      db.close();
    }
  });

  it("does not treat stderr-only output with a non-zero exit as usable", () => {
    const db = openDatabase(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "bugfix-codex-runtime-"));
    const path = join(dir, "fake-codex-stderr");
    writeFileSync(
      path,
      "#!/bin/sh\nprintf 'fake-codex 9.9\\n' >&2\nexit 1\n",
      { mode: 0o755 },
    );
    chmodSync(path, 0o755);
    try {
      const runtime = new CodexRuntimeService(
        new SystemSettingsService(db),
        path,
        "",
        undefined,
      );
      const fallback = runtime.detect().candidates.find(
        (candidate) => candidate.path === path,
      );
      expect(fallback?.available).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat stdout-only output with a non-zero exit as usable", () => {
    const db = openDatabase(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "bugfix-codex-runtime-"));
    const path = join(dir, "fake-codex-stdout");
    writeFileSync(
      path,
      "#!/bin/sh\nprintf 'fake-codex 9.9\\n'\nexit 1\n",
      { mode: 0o755 },
    );
    chmodSync(path, 0o755);
    try {
      const runtime = new CodexRuntimeService(
        new SystemSettingsService(db),
        path,
        "",
        undefined,
      );
      const fallback = runtime.detect().candidates.find(
        (candidate) => candidate.path === path,
      );
      expect(fallback?.available).toBe(false);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("codex runtime endpoints", () => {
  it("returns detection info and saves a manual path", async () => {
    const db = openDatabase(":memory:");
    const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-codex-api-"));
    const { dir, path } = createExecutableScript();
    const service = new BugfixService({
      db,
      worktreeRoot,
      eventBus: new EventBus(),
    });
    const app = await buildApp(service);
    try {
      const getResponse = await app.inject({
        method: "GET",
        url: "/api/runtime/codex",
      });
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toMatchObject({
        runtimeCommand: "codex-harness app-server --stdio",
        available: expect.any(Boolean),
        candidates: expect.any(Array),
      });

      const saveResponse = await app.inject({
        method: "PUT",
        url: "/api/runtime/codex",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ path }),
      });
      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toMatchObject({
        codexBin: path,
        source: "explicit",
        available: true,
        version: "fake-codex 1.0",
      });
    } finally {
      await app.close();
      db.close();
      rmSync(worktreeRoot, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
