import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  MessageTimeline,
  QuickCommandPalette,
} from "./conversation-pages.js";
import type { ConversationItem } from "./api.js";

function item(
  overrides: Partial<ConversationItem> & Pick<ConversationItem, "itemType">,
): ConversationItem {
  return {
    id: crypto.randomUUID(),
    conversationId: "conv-1",
    codexTurnId: null,
    codexItemId: null,
    parentItemId: null,
    role: null,
    author: null,
    title: null,
    status: "completed",
    payload: {},
    seq: 1,
    createdAtMs: Date.now(),
    completedAtMs: Date.now(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("MessageTimeline", () => {
  it("renders user and agent messages", () => {
    render(
      <MessageTimeline
        items={[
          item({
            itemType: "userMessage",
            role: "user",
            payload: { text: "你好" },
          }),
          item({
            itemType: "agentMessage",
            role: "assistant",
            payload: { text: "你好，我是 Codex" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("你好")).toBeTruthy();
    expect(screen.getByText("你好，我是 Codex")).toBeTruthy();
  });

  it("renders command and file change tool blocks", () => {
    render(
      <MessageTimeline
        items={[
          item({
            itemType: "commandExecution",
            payload: {
              command: "pnpm test",
              cwd: "/repo",
              aggregatedOutput: "PASS",
              exitCode: 0,
            },
          }),
          item({
            itemType: "fileChange",
            payload: {
              changes: [{ path: "src/a.ts", kind: "modified", diff: "+ok" }],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("pnpm test")).toBeTruthy();
    expect(screen.getByText("文件变更")).toBeTruthy();
  });

  it("renders only one copy of a locally persisted user message", () => {
    const { container } = render(
      <MessageTimeline
        items={[
          item({
            itemType: "userMessage",
            role: "user",
            payload: { text: "你好" },
          }),
          item({
            itemType: "userMessage",
            role: "user",
            codexItemId: "codex-user-1",
            payload: {
              content: [{ type: "text", text: "你好", text_elements: [] }],
            },
          }),
        ]}
      />,
    );

    expect(within(container).getAllByText("你好")).toHaveLength(1);
  });

  it("renders token usage without leaking raw JSON", () => {
    render(
      <MessageTimeline
        items={[
          item({
            itemType: "tokenUsage",
            payload: {
              tokenUsage: {
                last: { inputTokens: 12, outputTokens: 34 },
                total: {
                  inputTokens: 100,
                  outputTokens: 200,
                  totalTokens: 300,
                },
                modelContextWindow: 200000,
              },
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Token 用量")).toBeTruthy();
    expect(screen.getByText(/累计 输入 100/)).toBeTruthy();
    expect(screen.queryByText(/tokenUsage/)).toBeNull();
  });

  it("renders and invokes quick commands", () => {
    const commands: string[] = [];
    render(
      <QuickCommandPalette
        onRun={(command) => commands.push(command)}
        onClose={() => {}}
      />,
    );
    const model = screen.getByText("/model");
    model.click();
    expect(commands).toContain("/model");
  });
});
