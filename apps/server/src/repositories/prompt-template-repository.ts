import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_TEMPLATE_DEFINITIONS,
  type PromptTemplateDefinition,
  type PromptTemplateKey,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

export interface PromptTemplateSetting extends PromptTemplateDefinition {
  template: string;
  defaultTemplate: string;
}

interface PromptTemplateRow {
  key: PromptTemplateKey;
  content: string;
}

export class PromptTemplateRepository {
  constructor(private readonly db: AppDatabase) {}

  get(key: PromptTemplateKey): string {
    const row = this.db
      .prepare("SELECT content FROM prompt_templates WHERE key = ?")
      .get(key) as PromptTemplateRow | undefined;
    return row?.content ?? DEFAULT_PROMPT_TEMPLATES[key];
  }

  list(): PromptTemplateSetting[] {
    const rows = this.db
      .prepare("SELECT key, content FROM prompt_templates")
      .all() as unknown as PromptTemplateRow[];
    const savedByKey = new Map(rows.map((row) => [row.key, row.content]));

    return PROMPT_TEMPLATE_DEFINITIONS.map((definition) => ({
      ...definition,
      defaultTemplate: DEFAULT_PROMPT_TEMPLATES[definition.key],
      template: savedByKey.get(definition.key) ?? DEFAULT_PROMPT_TEMPLATES[definition.key],
    }));
  }

  save(key: PromptTemplateKey, content: string): PromptTemplateSetting {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO prompt_templates(key, content, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           content = excluded.content,
           updated_at = excluded.updated_at`,
      )
      .run(key, content, now);
    return this.list().find((item) => item.key === key)!;
  }

  reset(key?: PromptTemplateKey): PromptTemplateSetting[] {
    if (key) {
      this.db.prepare("DELETE FROM prompt_templates WHERE key = ?").run(key);
    } else {
      this.db.prepare("DELETE FROM prompt_templates").run();
    }
    return this.list();
  }
}
