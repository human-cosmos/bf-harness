import { describe, expect, it } from "vitest";
import {
  redactObject,
  redactSensitive,
} from "../src/services/redaction.js";
import {
  retentionSummary,
  shouldWarnTotalData,
} from "../src/services/retention.js";

describe("redaction", () => {
  it("redacts bearer tokens and private keys", () => {
    const input = "Authorization: Bearer abcdefghijklmnop\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
    const output = redactSensitive(input);
    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).not.toContain("secret");
    expect(output).toContain("[REDACTED:");
  });

  it("redacts nested object values", () => {
    const output = redactObject({
      headers: { authorization: "Bearer abcdefghijklmnop" },
    });
    expect(output.headers.authorization).toContain("[REDACTED:");
  });
});

describe("retention", () => {
  it("warns when total data reaches 80%", () => {
    expect(shouldWarnTotalData(4.1 * 1024 * 1024 * 1024)).toBe(true);
    expect(shouldWarnTotalData(3 * 1024 * 1024 * 1024)).toBe(false);
  });

  it("reports task log limit", () => {
    expect(retentionSummary({ taskLogBytes: 101 * 1024 * 1024, totalDataBytes: 0 }).taskLogExceeded).toBe(true);
  });
});
