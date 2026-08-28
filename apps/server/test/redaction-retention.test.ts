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

  it("redacts passwords containing spaces and quoted values", () => {
    const output = redactSensitive('password: "my secret value"');
    expect(output).not.toContain("my secret value");
    expect(output).toContain("[REDACTED:Password]");
  });

  it("redacts AWS secret access keys", () => {
    const output = redactSensitive("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(output).not.toContain("wJalrXUtnFEMI/K7MDENG");
    expect(output).toContain("[REDACTED:AWS secret access key]");
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
