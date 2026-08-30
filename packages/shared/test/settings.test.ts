import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_SETTINGS,
  systemSettingsSchema,
} from "../src/settings.js";

describe("system settings schema", () => {
  it("accepts the default settings", () => {
    expect(systemSettingsSchema.safeParse(DEFAULT_SYSTEM_SETTINGS).success).toBe(
      true,
    );
  });

  it("rejects invalid numeric limits", () => {
    const result = systemSettingsSchema.safeParse({
      ...DEFAULT_SYSTEM_SETTINGS,
      storage: {
        ...DEFAULT_SYSTEM_SETTINGS.storage,
        totalDataLimitBytes: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional model settings", () => {
    const result = systemSettingsSchema.safeParse({
      ...DEFAULT_SYSTEM_SETTINGS,
      models: {
        ...DEFAULT_SYSTEM_SETTINGS.models,
        bugfixModel: "gpt-test",
        bugfixReasoningEffort: "high",
      },
    });
    expect(result.success).toBe(true);
  });
});
