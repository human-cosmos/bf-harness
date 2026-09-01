import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_SETTINGS,
  mergeSystemSettings,
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

  it("defaults bugfix automation to manual review", () => {
    expect(DEFAULT_SYSTEM_SETTINGS.security.bugfixAutomationMode).toBe("manual");
    expect(DEFAULT_SYSTEM_SETTINGS.security.analyzeApprovalPolicy).toBe(
      "on-request",
    );
    expect(DEFAULT_SYSTEM_SETTINGS.security.analyzeApprovalsReviewer).toBe(
      "user",
    );
  });

  it("fills missing security fields from defaults", () => {
    const merged = mergeSystemSettings({
      security: {
        analyzeApprovalPolicy: "never",
        analyzeApprovalsReviewer: "auto_review",
        implementApprovalPolicy: "never",
        implementApprovalsReviewer: "auto_review",
      },
    });
    expect(merged.security.bugfixAutomationMode).toBe("manual");
    expect(merged.security.analyzeApprovalPolicy).toBe("never");
    expect(merged.agent).toEqual(DEFAULT_SYSTEM_SETTINGS.agent);
  });
});
