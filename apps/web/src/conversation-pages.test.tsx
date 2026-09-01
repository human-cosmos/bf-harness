import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createRef } from "react";
import {
  ConversationPage,
  ConversationListPage,
  MessageTimeline,
  PendingPanel,
  QuickCommandPalette,
  UserMessageIndex,
  type UserMessageEntry,
} from "./conversation-pages.js";
import {
  api,
  type Conversation,
  type ConversationApproval,
  type ConversationClarification,
  type ConversationItem,
} from "./api.js";

vi.mock("./api.js", () => ({
  api: {
    listConversations: vi.fn(),
    listConversationPage: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    getConversation: vi.fn(),
    listConversationItems: vi.fn(),
    listConversationEvents: vi.fn(),
    listConversationApprovals: vi.fn(),
    getConversationClarification: vi.fn(),
    syncConversation: vi.fn(),
    decideConversationApproval: vi.fn(),
    answerConversationClarification: vi.fn(),
    sendConversationMessage: vi.fn(),
    interruptConversation: vi.fn(),
    forkConversation: vi.fn(),
    compactConversation: vi.fn(),
    renameConversation: vi.fn(),
    listConversationModels: vi.fn(),
  },
}));

vi.mock("./use-conversation-events.js", () => ({
  useConversationEvents: () => ({
    connected: true,
    reconnecting: false,
    events: [],
  }),
}));

afterEach(cleanup);

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

const conversation: Conversation = {
  id: "conversation-1",
  projectId: "project-1",
  title: "示例对话",
  codexThreadId: null,
  status: "IDLE",
  policy: {
    sandboxMode: "workspace-write",
    networkAccess: false,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    allowGitWrites: false,
  },
  settings: {},
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function userMessageEntry(
  overrides: Partial<UserMessageEntry> & { id: string; text: string },
): UserMessageEntry {
  const message = item({
    id: overrides.id,
    itemType: "userMessage",
    role: "user",
    payload: { text: overrides.text },
  });
  return {
    id: message.id,
    groupIndex: overrides.groupIndex ?? 0,
    text: overrides.text,
    createdAt: message.createdAt,
    item: message,
  };
}

function conversationApproval(
  overrides: Partial<ConversationApproval> = {},
): ConversationApproval {
  return {
    id: "approval-1",
    conversationId: "conversation-1",
    codexTurnId: null,
    codexItemId: null,
    codexRequestId: null,
    method: "file",
    kind: "file",
    payload: { path: "src/a.ts" },
    riskLevel: "high",
    decision: null,
    decidedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function conversationClarification(
  overrides: Partial<ConversationClarification> = {},
): ConversationClarification {
  return {
    id: "clarification-1",
    conversationId: "conversation-1",
    codexRequestId: null,
    codexTurnId: null,
    codexItemId: null,
    questions: [{ id: "q1", question: "请补充" }],
    answers: null,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    answeredAt: null,
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

  it("renders reasoning summary from current Codex protocol items", () => {
    render(
      <MessageTimeline
        items={[
          item({
            itemType: "userMessage",
            role: "user",
            payload: { text: "分析项目" },
          }),
          item({
            itemType: "reasoning",
            payload: {
              type: "reasoning",
              summary: ["先检查依赖清单", "再核对运行配置"],
              content: [],
            },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByText("本轮详情（1 项）"));
    fireEvent.click(screen.getByText("思考过程"));

    expect(screen.getByText(/先检查依赖清单/)).toBeTruthy();
    expect(screen.getByText(/再核对运行配置/)).toBeTruthy();
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

describe("ConversationListPage delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirms before deleting a conversation", async () => {
    vi.mocked(api.listConversationPage)
      .mockResolvedValueOnce({
        items: [conversation],
        total: 1,
        page: 1,
        pageSize: 12,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        pageSize: 12,
      });
    vi.mocked(api.deleteConversation).mockResolvedValue({ deleted: true });

    render(
      <MemoryRouter initialEntries={["/projects/project-1/chat"]}>
        <Routes>
          <Route path="/projects/:id/chat" element={<ConversationListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("示例对话")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "删除对话 示例对话" }),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/确定删除“示例对话”吗/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除对话" }));

    await waitFor(() => {
      expect(api.deleteConversation).toHaveBeenCalledWith("conversation-1");
    });
    expect(await screen.findByText("对话已删除")).toBeTruthy();
    expect(screen.queryByText("示例对话")).toBeNull();
  });

  it("cancels without deleting", async () => {
    vi.mocked(api.listConversationPage).mockResolvedValueOnce({
      items: [conversation],
      total: 1,
      page: 1,
      pageSize: 12,
    });

    render(
      <MemoryRouter initialEntries={["/projects/project-1/chat"]}>
        <Routes>
          <Route path="/projects/:id/chat" element={<ConversationListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("示例对话")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "删除对话 示例对话" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteConversation).not.toHaveBeenCalled();
  });
});

describe("UserMessageIndex", () => {
  it("filters user messages and jumps to the selected message", () => {
    const onJump = vi.fn();
    render(
      <UserMessageIndex
        messages={[
          userMessageEntry({ id: "message-1", groupIndex: 0, text: "第一条消息" }),
          userMessageEntry({ id: "message-2", groupIndex: 1, text: "第二条消息" }),
        ]}
        onJump={onJump}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("第一条消息")).toBeTruthy();
    expect(screen.getByText("第二条消息")).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "第二" },
    });

    expect(screen.queryByText("第一条消息")).toBeNull();
    fireEvent.click(screen.getByText("第二条消息"));
    expect(onJump).toHaveBeenCalledWith(
      expect.objectContaining({ id: "message-2" }),
    );
  });

  it("shows an empty state when there are no user messages", () => {
    render(
      <UserMessageIndex
        messages={[]}
        onJump={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("暂无用户消息")).toBeTruthy();
  });
});

describe("PendingPanel", () => {
  it("renders pending approvals and triggers decisions", () => {
    const onDecide = vi.fn();
    render(
      <PendingPanel
        approvals={[conversationApproval()]}
        clarification={null}
        busy={false}
        onDecide={onDecide}
        onJumpToClarification={() => {}}
        onClose={() => {}}
        panelRef={createRef()}
      />,
    );

    expect(screen.getByText("待处理")).toBeTruthy();
    expect(screen.getByText("1 项")).toBeTruthy();
    expect(screen.getByText("文件写入 src/a.ts")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "允许一次" }));
    expect(onDecide).toHaveBeenCalledWith("approval-1", "accept");
  });

  it("jumps to clarification and closes", () => {
    const onJumpToClarification = vi.fn();
    const onClose = vi.fn();
    render(
      <PendingPanel
        approvals={[]}
        clarification={conversationClarification()}
        busy={false}
        onDecide={() => {}}
        onJumpToClarification={onJumpToClarification}
        onClose={onClose}
        panelRef={createRef()}
      />,
    );

    expect(screen.getByText("Codex 需要补充信息")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "去补充" }));
    expect(onJumpToClarification).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ConversationPage pending badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getConversation).mockResolvedValue(conversation);
    vi.mocked(api.listConversationItems).mockResolvedValue([]);
    vi.mocked(api.listConversationEvents).mockResolvedValue([]);
    vi.mocked(api.getConversationClarification).mockResolvedValue(null);
    vi.mocked(api.listConversations).mockResolvedValue([]);
  });

  function renderConversationPage() {
    render(
      <MemoryRouter initialEntries={["/projects/project-1/chat/conversation-1"]}>
        <Routes>
          <Route
            path="/projects/:id/chat/:conversationId"
            element={<ConversationPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the badge and opens the pending panel", async () => {
    vi.mocked(api.listConversationApprovals).mockResolvedValue([
      conversationApproval(),
    ]);
    renderConversationPage();

    const badge = await screen.findByRole("button", { name: "待处理 1 项" });
    expect(badge).toBeTruthy();

    fireEvent.click(badge);
    const dialog = screen.getByRole("dialog", { name: "待处理事项" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText("文件写入 src/a.ts")).toBeTruthy();
  });

  it("clears the badge after deciding the approval", async () => {
    vi.mocked(api.listConversationApprovals)
      .mockResolvedValueOnce([conversationApproval()])
      .mockResolvedValue([]);
    vi.mocked(api.decideConversationApproval).mockResolvedValue({
      decided: true,
    });
    renderConversationPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "待处理 1 项" }),
    );
    const dialog = screen.getByRole("dialog", { name: "待处理事项" });
    fireEvent.click(within(dialog).getByRole("button", { name: "允许一次" }));

    await waitFor(() => {
      expect(api.decideConversationApproval).toHaveBeenCalledWith(
        "conversation-1",
        "approval-1",
        "accept",
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "待处理 1 项" }),
      ).toBeNull();
    });
  });
});
