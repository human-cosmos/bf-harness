import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { PromptTemplateRepository } from "../src/repositories/prompt-template-repository.js";

describe("PromptTemplateRepository", () => {
  it("returns defaults before any template is saved", () => {
    const db = openDatabase(":memory:");
    const repository = new PromptTemplateRepository(db);

    const templates = repository.list();
    expect(templates).toHaveLength(3);
    expect(repository.get("analyze")).toContain("Do not modify files");
    expect(repository.get("implement")).toContain("{{plan}}");
    expect(repository.get("planQuestion")).toContain("{{question}}");

    db.close();
  });

  it("saves, updates, and resets a template", () => {
    const db = openDatabase(":memory:");
    const repository = new PromptTemplateRepository(db);

    const saved = repository.save("analyze", "Custom analyze: {{contract}}");
    expect(saved.template).toBe("Custom analyze: {{contract}}");
    expect(repository.get("analyze")).toBe("Custom analyze: {{contract}}");

    repository.save("analyze", "Updated analyze: {{contract}}");
    expect(repository.get("analyze")).toBe("Updated analyze: {{contract}}");

    repository.reset("analyze");
    expect(repository.get("analyze")).toContain("Do not modify files");

    db.close();
  });

  it("resets every template when no key is provided", () => {
    const db = openDatabase(":memory:");
    const repository = new PromptTemplateRepository(db);

    repository.save("analyze", "Custom analyze");
    repository.save("implement", "Custom implement");
    repository.save("planQuestion", "Custom question");

    repository.reset();
    expect(repository.list().every((item) => item.template === item.defaultTemplate)).toBe(
      true,
    );

    db.close();
  });
});
