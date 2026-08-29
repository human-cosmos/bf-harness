import { describe, expect, it } from "vitest";
import {
  createConversationInputSchema,
  fallbackConversationTitle,
  isFullAccessConversationPolicy,
  sendConversationMessageSchema,
  DEFAULT_CONVERSATION_POLICY,
} from "../src/index.js";

describe("conversation shared model", () => {
  it("uses safe defaults when creating a conversation", () => {
    const parsed = createConversationInputSchema.parse({
      projectId: "00000000-0000-4000-8000-000000000001",
    });

    expect(parsed.title).toBe("");
    expect(parsed.policy).toEqual(DEFAULT_CONVERSATION_POLICY);
    expect(parsed.policy.sandboxMode).toBe("workspace-write");
    expect(parsed.policy.networkAccess).toBe(false);
    expect(parsed.policy.approvalPolicy).toBe("on-request");
    expect(parsed.policy.approvalsReviewer).toBe("user");
  });

  it("rejects invalid policy values", () => {
    expect(() =>
      createConversationInputSchema.parse({
        projectId: "00000000-0000-4000-8000-000000000001",
        policy: { sandboxMode: "unknown" },
      }),
    ).toThrow();
  });

  it("validates message input", () => {
    const parsed = sendConversationMessageSchema.parse({
      text: "请查看 @app.ts",
      mentions: [
        { name: "app.ts", path: "/repo/app.ts" },
      ],
    });
    expect(parsed.text).toBe("请查看 @app.ts");
    expect(parsed.mentions).toHaveLength(1);
  });

  it("rejects an empty message without mentions", () => {
    expect(() => sendConversationMessageSchema.parse({ text: "   " })).toThrow();
  });

  it("creates a fallback title from the first non-empty line", () => {
    expect(fallbackConversationTitle("\n  请修复登录问题\n更多内容")).toBe(
      "请修复登录问题",
    );
    expect(fallbackConversationTitle("   ")).toBe("未命名对话");
  });

  it("detects full access policy only when all switches are enabled", () => {
    expect(isFullAccessConversationPolicy(DEFAULT_CONVERSATION_POLICY)).toBe(
      false,
    );
    expect(
      isFullAccessConversationPolicy({
        ...DEFAULT_CONVERSATION_POLICY,
        sandboxMode: "danger-full-access",
        networkAccess: true,
        allowGitWrites: true,
      }),
    ).toBe(true);
  });
});
