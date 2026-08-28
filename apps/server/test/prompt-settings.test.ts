import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_TEMPLATES,
  MAX_PROMPT_TEMPLATE_LENGTH,
} from "@bugfix-harness/shared";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { BugfixService } from "../src/services/bugfix-service.js";
import { EventBus } from "../src/services/event-bus.js";

async function createPromptApp() {
  const db = openDatabase(":memory:");
  const worktreeRoot = mkdtempSync(join(tmpdir(), "bugfix-prompt-settings-"));
  const service = new BugfixService({
    db,
    worktreeRoot,
    eventBus: new EventBus(),
  });
  const app = await buildApp(service);
  return { app, db, worktreeRoot };
}

async function closePromptApp(input: {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: ReturnType<typeof openDatabase>;
  worktreeRoot: string;
}) {
  await input.app.close();
  input.db.close();
  rmSync(input.worktreeRoot, { recursive: true, force: true });
}

describe("prompt settings endpoints", () => {
  it("lists the three default prompt templates", async () => {
    const fixture = await createPromptApp();
    try {
      const response = await fixture.app.inject({
        method: "GET",
        url: "/api/settings/prompts",
      });

      expect(response.statusCode).toBe(200);
      const templates = response.json() as Array<{
        key: string;
        template: string;
        defaultTemplate: string;
      }>;
      expect(templates).toHaveLength(3);
      expect(templates.every((item) => item.template === item.defaultTemplate)).toBe(
        true,
      );
      expect(templates.find((item) => item.key === "analyze")?.template).toBe(
        DEFAULT_PROMPT_TEMPLATES.analyze,
      );
    } finally {
      await closePromptApp(fixture);
    }
  });

  it("rejects unknown keys, empty values, unknown placeholders, and oversized templates", async () => {
    const fixture = await createPromptApp();
    try {
      const unknownKey = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings/prompts",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ templates: { typo: "x" } }),
      });
      expect(unknownKey.statusCode).toBe(400);
      expect(unknownKey.json()).toMatchObject({
        error: expect.stringContaining("Unknown prompt template key"),
      });

      const emptyValue = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings/prompts",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ templates: { analyze: "" } }),
      });
      expect(emptyValue.statusCode).toBe(400);

      const unknownPlaceholder = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings/prompts",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          templates: { analyze: "Bad {{contarct}}" },
        }),
      });
      expect(unknownPlaceholder.statusCode).toBe(400);
      expect(unknownPlaceholder.json()).toMatchObject({
        error: expect.stringContaining("unknown placeholders"),
      });

      const oversized = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings/prompts",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          templates: {
            analyze: "a".repeat(MAX_PROMPT_TEMPLATE_LENGTH + 1),
          },
        }),
      });
      expect(oversized.statusCode).toBe(400);
      expect(oversized.json()).toMatchObject({
        error: expect.stringContaining("exceeds"),
      });
    } finally {
      await closePromptApp(fixture);
    }
  });

  it("saves a template and resets one or all templates back to defaults", async () => {
    const fixture = await createPromptApp();
    try {
      const saveResponse = await fixture.app.inject({
        method: "PUT",
        url: "/api/settings/prompts",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          templates: {
            analyze: "Custom analyze: {{contract}}",
          },
        }),
      });
      expect(saveResponse.statusCode).toBe(200);
      expect(
        (saveResponse.json() as Array<{ key: string; template: string }>).find(
          (item) => item.key === "analyze",
        )?.template,
      ).toBe("Custom analyze: {{contract}}");

      const resetOne = await fixture.app.inject({
        method: "POST",
        url: "/api/settings/prompts/reset",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ key: "analyze" }),
      });
      expect(resetOne.statusCode).toBe(200);
      expect(
        (resetOne.json() as Array<{ key: string; template: string }>).find(
          (item) => item.key === "analyze",
        )?.template,
      ).toBe(DEFAULT_PROMPT_TEMPLATES.analyze);

      await fixture.app.inject({
        method: "PUT",
        url: "/api/settings/prompts",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          templates: {
            analyze: "Custom analyze",
            implement: "Custom implement",
          },
        }),
      });

      const resetAll = await fixture.app.inject({
        method: "POST",
        url: "/api/settings/prompts/reset",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({}),
      });
      expect(resetAll.statusCode).toBe(200);
      expect(
        (resetAll.json() as Array<{
          key: string;
          template: string;
          defaultTemplate: string;
        }>).every((item) => item.template === item.defaultTemplate),
      ).toBe(true);
    } finally {
      await closePromptApp(fixture);
    }
  });
});
