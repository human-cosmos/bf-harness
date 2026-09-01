import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  type Conversation,
  type ConversationApproval,
  type ConversationClarification,
  type ConversationEvent,
  type ConversationItem,
} from "./api.js";
import { useConversationEvents } from "./use-conversation-events.js";
import { PageBackLink } from "./PageBackLink.js";

function formatDate(value: string | number | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="notice notice-error" role="alert">
      {message}
    </div>
  );
}

function SuccessNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="notice notice-success" role="status">
      {message}
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-delete-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="conversation-delete-dialog-title">{title}</h2>
        <div className="dialog-message">{message}</div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "删除中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Loading({ children }: { children?: ReactNode }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{children ?? "加载中..."}</span>
    </div>
  );
}

function Card({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card conversation-card">
      <div className="card-head">
        <h2>{title}</h2>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function textFromItem(item: ConversationItem): string {
  const payload = item.payload ?? {};
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.delta === "string") return payload.delta;
  if (typeof payload.content === "string") return payload.content;
  if (typeof payload.message === "string") return payload.message;
  if (Array.isArray(payload.content)) {
    const contentText = payload.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (contentText) return contentText;
  }
  if (Array.isArray(payload.summary)) {
    return payload.summary
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (item.itemType === "commandExecution" && typeof payload.command === "string") {
    return payload.command;
  }
  return "";
}

function conversationDisplayTitle(title: string): string {
  return title.trim() || "新对话";
}

type ConversationBadgeTone = "neutral" | "active" | "warning" | "danger";

const CONVERSATION_STATUS_META: Record<
  Conversation["status"],
  { label: string; tone: ConversationBadgeTone }
> = {
  IDLE: { label: "空闲", tone: "neutral" },
  RUNNING: { label: "进行中", tone: "active" },
  WAITING_APPROVAL: { label: "待审批", tone: "warning" },
  WAITING_CLARIFICATION: { label: "待澄清", tone: "warning" },
  FAILED: { label: "失败", tone: "danger" },
  ARCHIVED: { label: "已归档", tone: "neutral" },
};

function conversationStatusMeta(status: Conversation["status"]) {
  return (
    CONVERSATION_STATUS_META[status] ?? { label: status, tone: "neutral" as const }
  );
}

type ToolbarIconName =
  | "stop"
  | "fork"
  | "compress"
  | "shield"
  | "list"
  | "terminal"
  | "edit"
  | "paperclip"
  | "send"
  | "trash"
  | "messages"
  | "bell";

const toolbarIcons: Record<ToolbarIconName, ReactNode> = {
  stop: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </>
  ),
  fork: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v4c0 2 1.5 3 3.5 3H15" />
      <path d="M15 14v4" />
      <path d="M18 6v4c0 2-1.5 3-3.5 3" />
    </>
  ),
  compress: (
    <>
      <path d="M8 3H3v5" />
      <path d="M3 3l5 5" />
      <path d="M16 21h5v-5" />
      <path d="M21 21l-5-5" />
      <path d="M7 21H4v-3" />
      <path d="M17 3h3v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>
  ),
  terminal: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M8 9l3 3-3 3" />
      <path d="M13 15h4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11a2 2 0 0 0-3-3L5 17v3z" />
      <path d="M13 7l3 3" />
    </>
  ),
  paperclip: (
    <>
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  messages: (
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
};

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  return (
    <svg
      className="toolbar-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {toolbarIcons[name]}
    </svg>
  );
}

function CommandBlock({ item }: { item: ConversationItem }) {
  const payload = item.payload ?? {};
  const command = String(payload.command ?? textFromItem(item) ?? "");
  const output = String(payload.aggregatedOutput ?? payload.delta ?? payload.output ?? "");
  const exitCode = payload.exitCode === undefined ? null : payload.exitCode;
  const durationMs = payload.durationMs === undefined ? null : payload.durationMs;

  return (
    <details className="conversation-tool-block command-block">
      <summary>
        <span className="block-label">命令</span>
        <span className="mono muted">{command || "命令执行"}</span>
      </summary>
      <div className="block-meta">
        {payload.cwd ? <span className="mono muted">cwd: {String(payload.cwd)}</span> : null}
        {exitCode !== null ? <span>退出码: {String(exitCode)}</span> : null}
        {durationMs !== null ? <span>耗时: {String(durationMs)}ms</span> : null}
      </div>
      {output ? <pre className="conversation-pre">{output}</pre> : null}
    </details>
  );
}

function FileChangeBlock({ item }: { item: ConversationItem }) {
  const payload = item.payload ?? {};
  const changes = Array.isArray(payload.changes)
    ? (payload.changes as Array<Record<string, unknown>>)
    : [];

  return (
    <details className="conversation-tool-block file-change-block">
      <summary>
        <span className="block-label">文件变更</span>
        <span className="muted">{changes.length} 个文件</span>
      </summary>
      {changes.length === 0 ? (
        <pre className="conversation-pre">{String(payload.diff ?? "")}</pre>
      ) : (
        changes.map((change, index) => (
          <div key={index} className="file-change-entry">
            <div className="mono muted">
              {String(change.path ?? "unknown")} · {String(change.kind ?? "")}
            </div>
            <pre className="conversation-pre">{String(change.diff ?? "")}</pre>
          </div>
        ))
      )}
    </details>
  );
}

function McpToolBlock({ item }: { item: ConversationItem }) {
  const payload = item.payload ?? {};
  return (
    <details className="conversation-tool-block mcp-block">
      <summary>
        <span className="block-label">MCP 工具</span>
        <span className="mono muted">
          {String(payload.server ?? "")}/{String(payload.tool ?? "")}
        </span>
      </summary>
      <div className="block-meta">
        <span>状态: {String(payload.status ?? item.status ?? "")}</span>
      </div>
      <pre className="conversation-pre">
        {JSON.stringify(payload.arguments ?? payload.result ?? payload, null, 2)}
      </pre>
    </details>
  );
}

function ApprovalInline({
  approval,
  onDecide,
  busy,
}: {
  approval: ConversationApproval;
  onDecide: (
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => void;
  busy: boolean;
}) {
  const payload = approval.payload ?? {};
  const label =
    approval.kind === "network"
      ? `网络请求 ${String(payload.host ?? "")}`
      : approval.kind === "file"
        ? `文件写入 ${String(payload.grantRoot ?? payload.path ?? "")}`
        : approval.kind === "permissions"
          ? "额外权限请求"
          : `命令 ${String(payload.command ?? "")}`;

  return (
    <div className="conversation-approval">
      <div className="conversation-approval-head">
        <strong>待审批</strong>
        <span className={`badge badge-${approval.riskLevel === "high" ? "danger" : "warning"}`}>
          {approval.riskLevel}
        </span>
      </div>
      <div className="mono muted conversation-approval-payload">{label}</div>
      <div className="actions">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => onDecide("accept")}
        >
          允许一次
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("acceptForSession")}
        >
          允许本次会话
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={busy}
          onClick={() => onDecide("decline")}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

function ClarificationInline({
  clarification,
  onAnswer,
  busy,
}: {
  clarification: ConversationClarification;
  onAnswer: (answers: Record<string, { answers: string[] }>) => void;
  busy: boolean;
}) {
  const questions = Array.isArray(clarification.questions)
    ? (clarification.questions as Array<Record<string, unknown>>)
    : [];
  const [values, setValues] = useState<Record<string, string>>({});

  function submit() {
    const answers: Record<string, { answers: string[] }> = {};
    for (const question of questions) {
      const id = String(question.id ?? "");
      const value = String(values[id] ?? "").trim();
      if (value) answers[id] = { answers: [value] };
    }
    onAnswer(answers);
  }

  return (
    <div className="conversation-clarification card notice-card">
      <div className="card-head">
        <h2>Codex 需要补充信息</h2>
      </div>
      {questions.map((question) => {
        const id = String(question.id ?? "");
        return (
          <label className="field" key={id}>
            {String(question.question ?? question.header ?? "请补充")}
            <textarea
              aria-label={String(question.question ?? question.header ?? "请补充")}
              value={values[id] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [id]: event.target.value }))
              }
            />
          </label>
        );
      })}
      <div className="form-actions">
        <button className="btn-primary" type="button" disabled={busy} onClick={submit}>
          {busy ? "提交中..." : "提交并继续"}
        </button>
      </div>
    </div>
  );
}

export function PendingPanel({
  approvals,
  clarification,
  busy,
  onDecide,
  onJumpToClarification,
  onClose,
  panelRef,
}: {
  approvals: ConversationApproval[];
  clarification: ConversationClarification | null;
  busy: boolean;
  onDecide: (
    approvalId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) => void;
  onJumpToClarification: () => void;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const count = approvals.length + (clarification ? 1 : 0);

  return (
    <div
      ref={panelRef}
      className="pending-panel"
      role="dialog"
      aria-label="待处理事项"
      aria-modal="true"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="pending-panel-head">
        <strong>待处理</strong>
        <span className="badge badge-warning">{count} 项</span>
        <button type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="pending-panel-body">
        {clarification ? (
          <div className="pending-panel-item">
            <div className="pending-panel-item-title">Codex 需要补充信息</div>
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={onJumpToClarification}
              >
                去补充
              </button>
            </div>
          </div>
        ) : null}
        {approvals.map((approval) => (
          <ApprovalInline
            key={approval.id}
            approval={approval}
            busy={busy}
            onDecide={(decision) => onDecide(approval.id, decision)}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityInspector({ events }: { events: ConversationEvent[] }) {
  return (
    <details className="conversation-tool-block activity-inspector">
      <summary>
        <span className="block-label">事件日志</span>
        <span className="muted">{events.length} 条</span>
      </summary>
      <div className="activity-list">
        {events.length === 0 ? (
          <p className="muted">暂无事件。</p>
        ) : (
          events.map((event) => (
            <div className="activity-row" key={`${event.seq}-${event.id ?? event.method}`}>
              <span className="mono">{event.seq}</span>
              <span className="mono">{event.kind || event.method}</span>
              <span className="muted">{formatDate(event.emittedAtMs ?? event.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

function ConversationPolicyPanel({
  conversation,
  onSaved,
}: {
  conversation: Conversation;
  onSaved: (conversation: Conversation) => void;
}) {
  const [sandboxMode, setSandboxMode] = useState(conversation.policy.sandboxMode);
  const [networkAccess, setNetworkAccess] = useState(
    conversation.policy.networkAccess,
  );
  const [allowGitWrites, setAllowGitWrites] = useState(
    conversation.policy.allowGitWrites,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await api.updateConversation(conversation.id, {
        policy: {
          ...conversation.policy,
          sandboxMode,
          networkAccess,
          allowGitWrites,
        },
      });
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="conversation-policy-panel">
      <div className="field">
        <label>
          沙箱模式
          <select
            value={sandboxMode}
            onChange={(event) =>
              setSandboxMode(
                event.target.value as Conversation["policy"]["sandboxMode"],
              )
            }
          >
            <option value="read-only">只读</option>
            <option value="workspace-write">工作区可写</option>
            <option value="danger-full-access">完整访问</option>
          </select>
        </label>
      </div>
      <label className="field inline-field">
        <input
          type="checkbox"
          checked={networkAccess}
          onChange={(event) => setNetworkAccess(event.target.checked)}
        />
        允许网络
      </label>
      <label className="field inline-field">
        <input
          type="checkbox"
          checked={allowGitWrites}
          onChange={(event) => setAllowGitWrites(event.target.checked)}
        />
        允许 Git 写操作（commit/push/MR）
      </label>
      <ErrorNotice message={error} />
      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "保存中..." : "保存策略"}
        </button>
      </div>
    </form>
  );
}

function FileMentionPicker({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: (name: string, path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const response = await api.searchProjectFiles(projectId, query.trim());
        if (!cancelled) {
          const text = response.contentItems?.[0]?.text ?? "[]";
          setResults(JSON.parse(text) as string[]);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, query]);

  return (
    <div className="file-mention-picker">
      <input
        type="search"
        placeholder="搜索文件后添加引用"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {busy ? <span className="muted">搜索中...</span> : null}
      {results.length ? (
        <ul>
          {results.slice(0, 8).map((path) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => {
                  onSelect(path.split("/").at(-1) ?? path, path);
                  setQuery("");
                  setResults([]);
                }}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function QuickCommandPalette({
  onRun,
  onClose,
}: {
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const commands = [
    { command: "/model", description: "查看可用模型" },
    { command: "/policy", description: "打开策略面板" },
    { command: "/compact", description: "压缩上下文" },
    { command: "/fork", description: "Fork 当前对话" },
    { command: "/interrupt", description: "中断当前 turn" },
    { command: "/rename", description: "重命名对话" },
    { command: "/find", description: "定位用户消息" },
    { command: "/delete", description: "删除当前对话" },
    { command: "/help", description: "显示快捷指令说明" },
  ];

  return (
    <div
      className="quick-command-palette"
      role="menu"
      aria-label="快捷指令"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="quick-command-head">
        <strong>快捷指令</strong>
        <button type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      {commands.map((item) => (
        <button
          key={item.command}
          type="button"
          role="menuitem"
          onClick={() => {
            onRun(item.command);
            onClose();
          }}
        >
          <span className="mono">{item.command}</span>
          <span className="muted">{item.description}</span>
        </button>
      ))}
    </div>
  );
}

export interface UserMessageEntry {
  id: string;
  groupIndex: number;
  text: string;
  createdAt: string;
  item: ConversationItem;
}

export function UserMessageIndex({
  messages,
  onJump,
  onClose,
}: {
  messages: UserMessageEntry[];
  onJump: (entry: UserMessageEntry) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const filteredMessages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return messages;
    return messages.filter((message) =>
      message.text.toLocaleLowerCase().includes(needle),
    );
  }, [messages, query]);

  return (
    <div
      className="user-message-index"
      role="dialog"
      aria-label="定位用户消息"
      aria-modal="true"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="user-message-index-head">
        <strong>定位用户消息</strong>
        <button type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="user-message-index-search">
        <input
          type="search"
          aria-label="搜索用户消息"
          placeholder="搜索用户消息"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="user-message-index-list">
        {filteredMessages.length === 0 ? (
          <p className="muted user-message-index-empty">
            {messages.length === 0 ? "暂无用户消息" : "没有匹配的用户消息"}
          </p>
        ) : (
          filteredMessages.map((message) => (
            <button
              key={message.id}
              type="button"
              className="user-message-index-item"
              onClick={() => onJump(message)}
            >
              <span className="user-message-index-number">
                #{message.groupIndex + 1}
              </span>
              <span className="user-message-index-text">
                {message.text.trim() || "(空消息)"}
              </span>
              <span className="user-message-index-time">
                {formatDate(message.createdAt)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function useConversations(projectId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    try {
      setConversations(await api.listConversations(projectId));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  async function create(): Promise<Conversation | null> {
    if (!projectId) return null;
    try {
      const conversation = await api.createConversation(projectId, { title: "" });
      await refresh();
      return conversation;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }

  async function deleteConversation(id: string): Promise<boolean> {
    setDeletingId(id);
    try {
      await api.deleteConversation(id);
      await refresh();
      return true;
    } finally {
      setDeletingId(null);
    }
  }

  return {
    conversations,
    loading,
    error,
    deletingId,
    refresh,
    create,
    deleteConversation,
  };
}

function ConversationRail({
  projectId,
  conversations,
  loading,
  error,
  activeId,
  onCreate,
  deletingId,
  onDelete,
}: {
  projectId: string;
  conversations: Conversation[];
  loading: boolean;
  error: string;
  activeId?: string;
  onCreate: () => void;
  deletingId?: string | null;
  onDelete: (conversation: Conversation) => void;
}) {
  return (
    <nav className="conversation-rail" aria-label="对话列表">
      <div className="rail-head">
        <span className="rail-label">对话</span>
        <button type="button" className="btn" onClick={onCreate}>
          新建
        </button>
      </div>
      {loading ? (
        <p className="muted">加载对话中...</p>
      ) : error ? (
        <p className="muted">对话列表加载失败：{error}</p>
      ) : conversations.length === 0 ? (
        <p className="muted">还没有对话</p>
      ) : (
        <div className="conversation-rail-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`conversation-rail-item${conversation.id === activeId ? " active" : ""}`}
            >
              <Link
                className="conversation-rail-link"
                to={`/projects/${projectId}/chat/${conversation.id}`}
              >
                <span className="conversation-rail-title">
                  {conversationDisplayTitle(conversation.title)}
                </span>
                <span className="muted mono">
                  {conversationStatusMeta(conversation.status).label}
                </span>
                <span className="muted mono">{formatDate(conversation.updatedAt)}</span>
              </Link>
              <button
                type="button"
                className="conversation-delete conversation-rail-delete"
                aria-label={`删除对话 ${conversationDisplayTitle(conversation.title)}`}
                disabled={deletingId === conversation.id}
                onClick={() => onDelete(conversation)}
              >
                <ToolbarIcon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

export function ConversationListPage() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<Conversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function load(pageNumber: number) {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.listConversationPage(
        projectId,
        pageNumber,
        PAGE_SIZE,
      );
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(page);
  }, [projectId, page]);

  async function createConversation() {
    if (!projectId) return;
    try {
      const conversation = await api.createConversation(projectId, {
        title: "",
      });
      navigate(`/projects/${projectId}/chat/${conversation.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !projectId) return;
    setDeleteBusy(true);
    setDeleteError("");
    setDeleteMessage("");
    setDeletingId(pendingDelete.id);
    try {
      await api.deleteConversation(pendingDelete.id);
      setPendingDelete(null);
      setDeleteMessage("对话已删除");
      if (items.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        void load(page);
      }
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleteBusy(false);
      setDeletingId(null);
    }
  }

  return (
    <section>
      <PageBackLink to={`/projects/${projectId}`} label="返回项目任务" />
      <div className="page-header">
        <div>
          <p className="page-kicker">项目对话</p>
          <h1>自由对话</h1>
        </div>
        <div className="page-actions">
          <button className="btn-primary" type="button" onClick={createConversation}>
            新建对话
          </button>
        </div>
      </div>
      <ErrorNotice message={error} />
      <SuccessNotice message={deleteMessage} />
      <ErrorNotice message={deleteError} />
      {loading && items.length === 0 ? (
        <Loading>加载对话中...</Loading>
      ) : items.length === 0 ? (
        <div className="card empty-state">
          <h2>还没有对话</h2>
          <p className="muted">创建一个对话，开始和 Codex 自由交流。</p>
        </div>
      ) : (
        <>
          <div className="conversation-list">
            {items.map((conversation) => {
              const status = conversationStatusMeta(conversation.status);
              return (
                <div
                  key={conversation.id}
                  className="conversation-list-item"
                  data-status={conversation.status}
                >
                  <Link
                    className="conversation-list-link"
                    to={`/projects/${projectId}/chat/${conversation.id}`}
                  >
                    <div className="conversation-card-main">
                      <span className="conversation-card-id">
                        CONV-{conversation.id.slice(0, 8)}
                      </span>
                      <h2 className="conversation-card-title">
                        {conversationDisplayTitle(conversation.title)}
                      </h2>
                    </div>
                    <div className="conversation-card-meta">
                      <span className={`badge badge-${status.tone}`}>
                        {status.label}
                      </span>
                      <span className="conversation-card-time">
                        {formatDate(conversation.updatedAt)}
                      </span>
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="conversation-delete"
                    aria-label={`删除对话 ${conversationDisplayTitle(conversation.title)}`}
                    disabled={deletingId === conversation.id}
                    onClick={() => {
                      setDeleteError("");
                      setDeleteMessage("");
                      setPendingDelete(conversation);
                    }}
                  >
                    <ToolbarIcon name="trash" />
                  </button>
                </div>
              );
            })}
          </div>
          {total > 0 ? (
            <nav className="conversation-pagination" aria-label="对话分页">
              <span className="conversation-pagination-summary">
                第 {page} / {totalPages} 页 · 共 {total} 条对话
              </span>
              <div className="conversation-pagination-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={page >= totalPages || loading}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  下一页
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
      {pendingDelete ? (
        <ConfirmDialog
          title="删除对话"
          message={
            <>
              确定删除“{conversationDisplayTitle(pendingDelete.title)}”吗？相关消息、审批、澄清、事件记录都会被一并删除，且无法恢复。
              {pendingDelete.status === "RUNNING" ||
              pendingDelete.status === "WAITING_APPROVAL" ||
              pendingDelete.status === "WAITING_CLARIFICATION"
                ? " 当前对话仍在进行中，删除会先中断执行。"
                : ""}
            </>
          }
          confirmLabel="删除对话"
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!deleteBusy) setPendingDelete(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function ConversationPage() {
  const { id: projectId, conversationId } = useParams();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [events, setEvents] = useState<ConversationEvent[]>([]);
  const [approvals, setApprovals] = useState<ConversationApproval[]>([]);
  const [clarification, setClarification] =
    useState<ConversationClarification | null>(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<
    Array<{ name: string; path: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showMessageIndex, setShowMessageIndex] = useState(false);
  const [showPendingPanel, setShowPendingPanel] = useState(false);
  const [visibleGroupCount, setVisibleGroupCount] = useState(10);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const pendingButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingPanelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const websocket = useConversationEvents(conversationId);
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    deletingId,
    refresh: refreshList,
    create,
    deleteConversation,
  } = useConversations(projectId);

  const timelineGroups = useMemo(
    () => groupTimelineItems(dedupeTimelineItems(items)),
    [items],
  );
  const userMessages = useMemo<UserMessageEntry[]>(
    () =>
      timelineGroups.flatMap((group, groupIndex) => {
        if (!group.user) return [];
        return [
          {
            id: group.user.id,
            groupIndex,
            text: textFromItem(group.user),
            createdAt: group.user.createdAt,
            item: group.user,
          },
        ];
      }),
    [timelineGroups],
  );

  async function createAndOpen() {
    const next = await create();
    if (next) {
      navigate(`/projects/${projectId}/chat/${next.id}`);
    }
  }

  async function load(shouldSync = false) {
    if (!conversationId) return;
    try {
      const nextConversation = await api.getConversation(conversationId);
      if (shouldSync && nextConversation.codexThreadId) {
        try {
          await api.syncConversation(conversationId);
        } catch {
          // Sync is best-effort; local DB history remains authoritative.
        }
      }
      const [nextItems, nextEvents, nextApprovals, nextClarification] =
        await Promise.all([
          api.listConversationItems(conversationId),
          api.listConversationEvents(conversationId),
          api.listConversationApprovals(conversationId),
          api.getConversationClarification(conversationId),
        ]);
      setConversation(nextConversation);
      setItems(nextItems);
      setEvents(nextEvents);
      setApprovals(nextApprovals);
      setClarification(nextClarification);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load(true);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const timer = setInterval(() => {
      void load(false);
      void refreshList();
    }, 2500);
    return () => clearInterval(timer);
  }, [conversationId, refreshList]);

  useEffect(() => {
    if (websocket.events.length > 0) {
      void load(false);
    }
  }, [websocket.events.length]);

  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => !approval.decision),
    [approvals],
  );
  const pendingCount = pendingApprovals.length + (clarification ? 1 : 0);

  useEffect(() => {
    if (pendingApprovals.length === 0 && !clarification) {
      setShowPendingPanel(false);
    }
  }, [pendingApprovals, clarification]);

  useEffect(() => {
    if (showPendingPanel) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      pendingPanelRef.current?.querySelector<HTMLElement>("button")?.focus();
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [showPendingPanel]);

  useEffect(() => {
    if (!showPendingPanel) return;
    function handleMouseDown(event: MouseEvent) {
      const panel = pendingPanelRef.current;
      const button = pendingButtonRef.current;
      if (
        panel &&
        !panel.contains(event.target as Node) &&
        button &&
        !button.contains(event.target as Node)
      ) {
        setShowPendingPanel(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showPendingPanel]);

  function jumpToUserMessage(entry: UserMessageEntry) {
    const totalGroups = timelineGroups.length;
    setVisibleGroupCount((current) =>
      Math.max(current, totalGroups - entry.groupIndex),
    );
    setPendingJumpId(entry.id);
    setShowMessageIndex(false);
  }

  function jumpToClarification() {
    setShowPendingPanel(false);
    requestAnimationFrame(() => {
      document
        .getElementById("conversation-clarification")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setShowPendingPanel(false);
        setShowMessageIndex((current) => !current);
        return;
      }
      if (event.key === "Escape") {
        if (showPendingPanel) setShowPendingPanel(false);
        if (showMessageIndex) setShowMessageIndex(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showMessageIndex, showPendingPanel]);

  useEffect(() => {
    if (!pendingJumpId) return;

    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`user-message-${pendingJumpId}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(pendingJumpId);
      setPendingJumpId(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [pendingJumpId, items, visibleGroupCount]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timer = setTimeout(() => setHighlightedMessageId(null), 1600);
    return () => clearTimeout(timer);
  }, [highlightedMessageId]);

  async function send() {
    if (!conversationId || !text.trim()) return;
    const nextText = text;
    const nextMentions = mentions;
    setBusy(true);
    setError("");
    setMessage("");
    setText("");
    setMentions([]);
    let sent = false;
    try {
      await api.sendConversationMessage(conversationId, {
        text: nextText,
        mentions: nextMentions,
      });
      sent = true;
      await load();
    } catch (err) {
      setError((err as Error).message);
      if (!sent) {
        setText(nextText);
        setMentions(nextMentions);
      }
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(
    approvalId: string,
    decision: "accept" | "acceptForSession" | "decline" | "cancel",
  ) {
    if (!conversationId) return;
    setBusy(true);
    try {
      await api.decideConversationApproval(conversationId, approvalId, decision);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function answerClarification(
    answers: Record<string, { answers: string[] }>,
  ) {
    if (!conversationId || !clarification) return;
    setBusy(true);
    try {
      await api.answerConversationClarification(
        conversationId,
        clarification.id,
        answers,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function interrupt() {
    if (!conversationId) return;
    setBusy(true);
    try {
      await api.interruptConversation(conversationId);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fork() {
    if (!conversationId) return;
    setBusy(true);
    try {
      const forked = await api.forkConversation(conversationId, null);
      setMessage("已创建 fork 对话");
      navigate(`/projects/${projectId}/chat/${forked.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function compact() {
    if (!conversationId) return;
    setBusy(true);
    try {
      await api.compactConversation(conversationId);
      setMessage("已开始压缩上下文");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function renameConversation() {
    if (!conversationId || !renameValue.trim()) return;
    setBusy(true);
    try {
      const updated = await api.renameConversation(
        conversationId,
        renameValue.trim(),
      );
      setConversation(updated);
      setRenameValue("");
      setRenaming(false);
      setMessage("对话标题已更新");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !projectId) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteConversation(pendingDelete.id);
      const wasActive = pendingDelete.id === conversationId;
      setPendingDelete(null);
      if (wasActive) {
        navigate(`/projects/${projectId}/chat`);
      } else {
        setMessage("对话已删除");
      }
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function runQuickCommand(command: string) {
    if (command === "/policy") {
      setShowPolicy(true);
      return;
    }
    if (command === "/compact") {
      await compact();
      return;
    }
    if (command === "/fork") {
      await fork();
      return;
    }
    if (command === "/interrupt") {
      await interrupt();
      return;
    }
    if (command === "/model") {
      setBusy(true);
      try {
        const models = await api.listConversationModels(conversationId!);
        setMessage(`可用模型: ${JSON.stringify(models)}`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (command === "/rename") {
      setRenaming(true);
      setRenameValue(conversation?.title ?? "");
      return;
    }
    if (command === "/find") {
      setShowMessageIndex(true);
      return;
    }
    if (command === "/delete") {
      setDeleteError("");
      setPendingDelete(conversation);
      return;
    }
    if (command === "/help") {
      setMessage(
        "/model 查看模型 · /policy 策略 · /compact 压缩 · /fork Fork · /interrupt 中断 · /rename 重命名 · /find 定位消息 · /delete 删除",
      );
    }
  }

  if (!conversation) {
    return (
      <section>
        <PageBackLink to={`/projects/${projectId}/chat`} label="返回对话列表" />
        <ErrorNotice message={error} />
        <Loading>加载对话中...</Loading>
      </section>
    );
  }

  return (
    <section className="conversation-page">
      <PageBackLink to={`/projects/${projectId}/chat`} label="返回对话列表" />
      <div className="conversation-layout">
        <ConversationRail
          projectId={projectId!}
          conversations={conversations}
          loading={conversationsLoading}
          error={conversationsError}
          activeId={conversationId}
          onCreate={createAndOpen}
          deletingId={deletingId}
          onDelete={(conversationToDelete) => {
            setDeleteError("");
            setPendingDelete(conversationToDelete);
          }}
        />
        <div className="conversation-body">
      <div className="page-header conversation-page-header">
        <div className="conversation-heading">
          <p className="page-kicker">项目对话</p>
          <h1>{conversationDisplayTitle(conversation.title)}</h1>
        </div>
        <div className="conversation-header-tools">
          <div className="page-actions conversation-status-badges">
            <span className={`badge badge-${websocket.connected ? "success" : "warning"}`}>
              {websocket.connected ? "实时连接" : "重连中..."}
            </span>
            <span className="badge badge-neutral">{conversation.status}</span>
          </div>
          <div
            className="conversation-toolbar"
            role="toolbar"
            aria-label="对话操作"
          >
            <div className="conversation-toolbar-group">
              <button
                type="button"
                aria-label="中断"
                data-tooltip="中断"
                disabled={busy}
                onClick={interrupt}
              >
                <ToolbarIcon name="stop" />
              </button>
              <button
                type="button"
                aria-label="Fork"
                data-tooltip="Fork"
                disabled={busy}
                onClick={fork}
              >
                <ToolbarIcon name="fork" />
              </button>
              <button
                type="button"
                aria-label="压缩"
                data-tooltip="压缩"
                disabled={busy}
                onClick={compact}
              >
                <ToolbarIcon name="compress" />
              </button>
            </div>
            <span className="conversation-toolbar-separator" aria-hidden="true" />
            <div className="conversation-toolbar-group">
              <button
                type="button"
                aria-label="重命名"
                data-tooltip="重命名"
                onClick={() => {
                  setRenaming(true);
                  setRenameValue(conversation.title);
                }}
              >
                <ToolbarIcon name="edit" />
              </button>
              <button
                type="button"
                aria-label="策略"
                data-tooltip="策略"
                onClick={() => setShowPolicy((current) => !current)}
              >
                <ToolbarIcon name="shield" />
              </button>
              <button
                type="button"
                aria-label="快捷指令"
                data-tooltip="快捷指令"
                onClick={() => setShowCommands((current) => !current)}
              >
                <ToolbarIcon name="terminal" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showCommands ? (
        <QuickCommandPalette
          onRun={runQuickCommand}
          onClose={() => setShowCommands(false)}
        />
      ) : null}

      {renaming ? (
        <div className="conversation-rename">
          <span className="conversation-rename-label">
            <ToolbarIcon name="edit" />
          </span>
          <input
            aria-label="对话标题"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="输入新标题"
          />
          <button type="button" className="btn-primary" onClick={renameConversation}>
            保存标题
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setRenameValue("");
            }}
          >
            取消
          </button>
        </div>
      ) : null}

      {showPolicy ? (
        <Card title="对话策略">
          <ConversationPolicyPanel
            conversation={conversation}
            onSaved={(updated) => {
              setConversation(updated);
              setShowPolicy(false);
              setMessage("策略已保存");
            }}
          />
        </Card>
      ) : null}

      <ErrorNotice message={error} />
      <ErrorNotice message={deleteError} />
      <SuccessNotice message={message} />

      {clarification ? (
        <div id="conversation-clarification">
          <ClarificationInline
            clarification={clarification}
            onAnswer={answerClarification}
            busy={busy}
          />
        </div>
      ) : null}

      {pendingApprovals.map((approval) => (
        <ApprovalInline
          key={approval.id}
          approval={approval}
          busy={busy}
          onDecide={(decision) => decideApproval(approval.id, decision)}
        />
      ))}

      <ActivityInspector events={events} />

      <MessageTimeline
        key={conversationId}
        items={items}
        visibleGroupCount={visibleGroupCount}
        onVisibleGroupCountChange={setVisibleGroupCount}
        highlightedMessageId={highlightedMessageId}
      />

      <div className="conversation-composer-area">
        {showFilePicker ? (
          <FileMentionPicker
            projectId={projectId!}
            onSelect={(name, path) => {
              setMentions((current) => [
                ...current.filter((item) => item.path !== path),
                { name, path },
              ]);
              setText((current) => `${current} @${name}`.trim());
            }}
          />
        ) : null}
        {mentions.length ? (
          <div className="conversation-mentions">
            {mentions.map((mention) => (
              <button
                key={mention.path}
                type="button"
                className="mention-chip"
                onClick={() =>
                  setMentions((current) =>
                    current.filter((item) => item.path !== mention.path),
                  )
                }
              >
                {mention.name} ×
              </button>
            ))}
          </div>
        ) : null}
        {showMessageIndex ? (
          <UserMessageIndex
            messages={userMessages}
            onJump={jumpToUserMessage}
            onClose={() => setShowMessageIndex(false)}
          />
        ) : null}
        {showPendingPanel && pendingCount > 0 ? (
          <PendingPanel
            approvals={pendingApprovals}
            clarification={clarification}
            busy={busy}
            onDecide={decideApproval}
            onJumpToClarification={jumpToClarification}
            onClose={() => setShowPendingPanel(false)}
            panelRef={pendingPanelRef}
          />
        ) : null}
        <div className="conversation-composer">
          <textarea
            aria-label="对话输入"
            value={text}
            placeholder="向 Codex 描述你的任务，使用 @ 引用文件"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="conversation-composer-actions">
            <div className="composer-action-group">
              <button
                type="button"
                className={`composer-action composer-action-history${showMessageIndex ? " is-active" : ""}`}
                aria-label="定位用户消息"
                title="定位用户消息 (Cmd/Ctrl+J)"
                aria-pressed={showMessageIndex}
                onClick={() => {
                  setShowPendingPanel(false);
                  setShowMessageIndex((current) => !current);
                }}
              >
                <ToolbarIcon name="messages" />
                {userMessages.length > 0 ? (
                  <span className="composer-action-count">
                    {userMessages.length}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={`composer-action composer-action-attach${showFilePicker ? " is-active" : ""}`}
                aria-label="引用文件"
                title="引用文件"
                aria-pressed={showFilePicker}
                onClick={() => setShowFilePicker((current) => !current)}
              >
                <ToolbarIcon name="paperclip" />
              </button>
              {pendingCount > 0 ? (
                <button
                  ref={pendingButtonRef}
                  type="button"
                  className={`composer-action composer-action-pending${showPendingPanel ? " is-active" : ""}`}
                  aria-label={`待处理 ${pendingCount} 项`}
                  title={`待处理 ${pendingCount} 项`}
                  aria-pressed={showPendingPanel}
                  onClick={() => {
                    setShowMessageIndex(false);
                    setShowPendingPanel((current) => !current);
                  }}
                >
                  <ToolbarIcon name="bell" />
                  <span
                    className="composer-action-count composer-action-count-pending"
                    aria-live="polite"
                  >
                    {pendingCount}
                  </span>
                </button>
              ) : null}
            </div>
            <button
              className="composer-action composer-action-send"
              type="button"
              aria-label="发送"
              title="发送"
              disabled={busy || !text.trim()}
              onClick={send}
            >
              {busy ? <span className="spinner" aria-hidden="true" /> : <ToolbarIcon name="send" />}
            </button>
          </div>
        </div>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title="删除对话"
          message={
            <>
              确定删除“{conversationDisplayTitle(pendingDelete.title)}”吗？相关消息、审批、澄清、事件记录都会被一并删除，且无法恢复。
              {pendingDelete.status === "RUNNING" ||
              pendingDelete.status === "WAITING_APPROVAL" ||
              pendingDelete.status === "WAITING_CLARIFICATION"
                ? " 当前对话仍在进行中，删除会先中断执行。"
                : ""}
            </>
          }
          confirmLabel="删除对话"
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => {
            if (!deleteBusy) setPendingDelete(null);
          }}
        />
      ) : null}
        </div>
      </div>
    </section>
  );
}

interface TimelineGroup {
  key: string;
  user: ConversationItem | null;
  items: ConversationItem[];
}

const COLLAPSED_TURN_ITEM_TYPES = new Set([
  "reasoning",
  "plan",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "tokenUsage",
  "approval",
  "clarification",
  "contextCompaction",
  "webSearch",
  "imageGeneration",
]);

function groupTimelineItems(items: ConversationItem[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let current: TimelineGroup | null = null;

  for (const item of items) {
    if (item.itemType === "userMessage") {
      current = { key: item.id, user: item, items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { key: item.id, user: null, items: [item] };
      groups.push(current);
      continue;
    }
    current.items.push(item);
  }

  return groups;
}

function ConversationTurnGroup({
  group,
  highlightedMessageId,
}: {
  group: TimelineGroup;
  highlightedMessageId?: string | null;
}) {
  const primary = group.items.filter(
    (item) => !COLLAPSED_TURN_ITEM_TYPES.has(item.itemType),
  );
  const auxiliary = group.items.filter((item) =>
    COLLAPSED_TURN_ITEM_TYPES.has(item.itemType),
  );

  return (
    <div className="conversation-turn">
      {group.user ? (
        <ConversationItemBlock
          item={group.user}
          highlighted={highlightedMessageId === group.user.id}
        />
      ) : null}
      {primary.map((item) => (
        <ConversationItemBlock key={item.id} item={item} />
      ))}
      {auxiliary.length > 0 ? (
        <details className="turn-details">
          <summary>本轮详情（{auxiliary.length} 项）</summary>
          <div className="turn-details-body">
            {auxiliary.map((item) => (
              <ConversationItemBlock key={item.id} item={item} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function MessageTimeline({
  items,
  visibleGroupCount: controlledVisibleGroupCount,
  onVisibleGroupCountChange,
  highlightedMessageId,
}: {
  items: ConversationItem[];
  visibleGroupCount?: number;
  onVisibleGroupCountChange?: (count: number) => void;
  highlightedMessageId?: string | null;
}) {
  const [internalVisibleGroupCount, setInternalVisibleGroupCount] = useState(10);
  const visibleGroupCount =
    controlledVisibleGroupCount ?? internalVisibleGroupCount;
  const updateVisibleGroupCount = (count: number) => {
    if (onVisibleGroupCountChange) {
      onVisibleGroupCountChange(count);
    } else {
      setInternalVisibleGroupCount(count);
    }
  };
  const groups = useMemo(
    () => groupTimelineItems(dedupeTimelineItems(items)),
    [items],
  );

  if (groups.length === 0) {
    return (
      <div className="card empty-state">
        <h2>开始对话</h2>
        <p className="muted">发送一条消息后，Codex 的输出会显示在这里。</p>
      </div>
    );
  }

  const shownGroups = groups.slice(
    Math.max(0, groups.length - visibleGroupCount),
  );
  const hasMore = shownGroups.length < groups.length;

  return (
    <div className="conversation-timeline">
      {hasMore ? (
        <button
          type="button"
          className="btn"
          onClick={() => updateVisibleGroupCount(visibleGroupCount + 10)}
        >
          加载更早消息
        </button>
      ) : null}
      {shownGroups.map((group) => (
        <ConversationTurnGroup
          key={group.key}
          group={group}
          highlightedMessageId={highlightedMessageId}
        />
      ))}
    </div>
  );
}

function dedupeTimelineItems(items: ConversationItem[]): ConversationItem[] {
  const localUserIdentities = new Set(
    items
      .filter(
        (item) => item.itemType === "userMessage" && !item.codexItemId,
      )
      .map(userMessageIdentity)
      .filter(Boolean),
  );

  return items.filter((item) => {
    if (item.itemType !== "userMessage" || !item.codexItemId) {
      return true;
    }
    const identity = userMessageIdentity(item);
    return !(identity && localUserIdentities.has(identity));
  });
}

function userMessageIdentity(item: ConversationItem): string {
  const payload = item.payload as Record<string, unknown>;
  const text = textFromItem(item).trim();
  const mentions = Array.isArray(payload?.mentions)
    ? (payload.mentions as Array<Record<string, unknown>>)
        .flatMap((mention) => {
          if (
            typeof mention?.name !== "string" ||
            typeof mention?.path !== "string"
          ) {
            return [];
          }
          return [`${mention.name}\u0000${mention.path}`];
        })
        .sort()
    : Array.isArray(payload?.content)
      ? (payload.content as Array<Record<string, unknown>>)
          .flatMap((part) => {
            if (
              part?.type !== "mention" ||
              typeof part?.name !== "string" ||
              typeof part?.path !== "string"
            ) {
              return [];
            }
            return [`${part.name}\u0000${part.path}`];
          })
          .sort()
      : [];
  return JSON.stringify({ text, mentions });
}

type TokenBreakdown = {
  totalTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
};

function tokenUsageFromItem(item: ConversationItem): {
  total: TokenBreakdown | null;
  last: TokenBreakdown | null;
  modelContextWindow: number | null;
} {
  const payload = item.payload as Record<string, unknown>;
  const nested = payload?.tokenUsage as
    | {
        total?: TokenBreakdown;
        last?: TokenBreakdown;
        modelContextWindow?: number | null;
      }
    | undefined;
  const direct =
    payload &&
    typeof payload === "object" &&
    ("total" in payload || "inputTokens" in payload || "last" in payload)
      ? (payload as {
          total?: TokenBreakdown;
          last?: TokenBreakdown;
          modelContextWindow?: number | null;
        })
      : null;
  const usage = nested ?? direct;

  return {
    total: usage?.total ?? null,
    last: usage?.last ?? null,
    modelContextWindow: usage?.modelContextWindow ?? null,
  };
}

function formatTokenCount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function TokenUsageBlock({ item }: { item: ConversationItem }) {
  const usage = tokenUsageFromItem(item);
  const hasData = Boolean(usage.total || usage.last);

  return (
    <div className="token-usage muted">
      <span className="token-usage-title">Token 用量</span>
      {hasData ? (
        <div className="token-usage-stats">
          {usage.last ? (
            <span>
              本次 输入 {formatTokenCount(usage.last.inputTokens)} · 输出{" "}
              {formatTokenCount(usage.last.outputTokens)}
            </span>
          ) : null}
          {usage.total ? (
            <span>
              累计 输入 {formatTokenCount(usage.total.inputTokens)} · 输出{" "}
              {formatTokenCount(usage.total.outputTokens)} · 总计{" "}
              {formatTokenCount(usage.total.totalTokens)}
            </span>
          ) : null}
          {usage.modelContextWindow ? (
            <span>上下文窗口 {formatTokenCount(usage.modelContextWindow)}</span>
          ) : null}
        </div>
      ) : (
        <span>暂无 token 数据</span>
      )}
    </div>
  );
}

function ConversationItemBlock({
  item,
  highlighted = false,
}: {
  item: ConversationItem;
  highlighted?: boolean;
}) {
  const text = textFromItem(item);

  if (item.itemType === "userMessage") {
    return (
      <div
        id={`user-message-${item.id}`}
        className={`conversation-message user-message${highlighted ? " is-highlighted" : ""}`}
      >
        <div className="message-role">你</div>
        <div className="message-body">{text}</div>
        {Array.isArray(item.payload?.mentions) ? (
          <div className="user-message-mentions">
            {(item.payload.mentions as Array<{ name: string; path: string }>).map(
              (mention) => (
                <span key={mention.path} className="user-mention-chip">
                  {mention.name}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (item.itemType === "agentMessage") {
    return (
      <div className="conversation-message agent-message">
        <div className="message-role">Codex</div>
        <div className="message-body">{text || JSON.stringify(item.payload)}</div>
      </div>
    );
  }

  if (item.itemType === "reasoning") {
    return (
      <details className="reasoning-block">
        <summary>思考过程</summary>
        <pre className="conversation-pre">{text}</pre>
      </details>
    );
  }

  if (item.itemType === "plan") {
    return (
      <details className="plan-block" open>
        <summary>计划</summary>
        <pre className="conversation-pre">{text}</pre>
      </details>
    );
  }

  if (item.itemType === "commandExecution") {
    return <CommandBlock item={item} />;
  }

  if (item.itemType === "fileChange") {
    return <FileChangeBlock item={item} />;
  }

  if (item.itemType === "mcpToolCall") {
    return <McpToolBlock item={item} />;
  }

  if (item.itemType === "tokenUsage") {
    return <TokenUsageBlock item={item} />;
  }

  if (item.itemType === "warning" || item.itemType === "error") {
    return (
      <div className={`conversation-message system-message ${item.itemType}`}>
        {text || JSON.stringify(item.payload)}
      </div>
    );
  }

  return (
    <details className="conversation-tool-block raw-item">
      <summary>{item.itemType}</summary>
      <pre className="conversation-pre">{JSON.stringify(item.payload, null, 2)}</pre>
    </details>
  );
}
