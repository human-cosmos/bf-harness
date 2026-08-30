import type { SystemSettings } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

const SYSTEM_SETTINGS_KEY = "system";

interface SystemSettingsRow {
  key: string;
  value: string;
}

export class SystemSettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  get(): SystemSettings | null {
    const row = this.db
      .prepare("SELECT key, value FROM system_settings WHERE key = ?")
      .get(SYSTEM_SETTINGS_KEY) as SystemSettingsRow | undefined;
    if (!row) {
      return null;
    }
    return JSON.parse(row.value) as SystemSettings;
  }

  save(settings: SystemSettings): SystemSettings {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO system_settings(key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(SYSTEM_SETTINGS_KEY, JSON.stringify(settings), now);
    return settings;
  }

  reset(): void {
    this.db
      .prepare("DELETE FROM system_settings WHERE key = ?")
      .run(SYSTEM_SETTINGS_KEY);
  }
}
