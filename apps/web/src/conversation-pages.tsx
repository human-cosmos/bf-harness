import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
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
  if (item.itemType === "commandExecution" && typeof payload.command === "string") {
    return payload.command;
  }
  return "";
}

function CommandBlock({ item }: { item: ConversationItem }) {
  const payload = item.payload ?? {};
  const command = String(payload.command ?? textFromItem(item) ?? "");
  const output = String(payload.aggregatedOutput ?? payload.delta ?? payload.output ?? "");
  const exitCode = payload.exitCode === undefined ? null : payload.exitCode;
  const durationMs = payload.durationMs === undefined ? null : payload.durationMs;

  return (
    <details className="conversation-tool-block command-block" open>
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
    <details className="conversation-tool-block file-change-block" open>
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
    <details className="conversation-tool-block mcp-block" open>
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

export function ConversationListPage() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    if (!projectId) return;
    setLoading(true);
    try {
      setConversations(await api.listConversations(projectId));
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function createConversation() {
    if (!projectId) return;
    try {
      const conversation = await api.createConversation(projectId, { title: "" });
      navigate(`/projects/${projectId}/chat/${conversation.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <div className="page-context">
        <Link to={`/projects/${projectId}`} className="btn back-link">
          返回项目
        </Link>
      </div>
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
      {loading ? (
        <Loading>加载对话中...</Loading>
      ) : conversations.length === 0 ? (
        <div className="card empty-state">
          <h2>还没有对话</h2>
          <p className="muted">创建一个对话，开始和 Codex 自由交流。</p>
        </div>
      ) : (
        <div className="conversation-list">
          {conversations.map((conversation) => (
            <Link
              key={conversation.id}
              to={`/projects/${projectId}/chat/${conversation.id}`}
              className="conversation-list-item"
            >
              <strong>{conversation.title || "未命名对话"}</strong>
              <span className="muted">{conversation.status}</span>
              <span className="muted">{formatDate(conversation.updatedAt)}</span>
            </Link>
          ))}
        </div>
      )}
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
  const [showActivity, setShowActivity] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const websocket = useConversationEvents(conversationId);

  async function load() {
    if (!conversationId) return;
    try {
      const nextConversation = await api.getConversation(conversationId);
      if (nextConversation.codexThreadId) {
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
    void load();
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [conversationId]);

  useEffect(() => {
    if (websocket.events.length > 0) {
      void load();
    }
  }, [websocket.events.length]);

  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => !approval.decision),
    [approvals],
  );

  async function send() {
    if (!conversationId || !text.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.sendConversationMessage(conversationId, { text, mentions });
      setText("");
      setMentions([]);
      await load();
    } catch (err) {
      setError((err as Error).message);
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
    if (command === "/help") {
      setMessage(
        "/model 查看模型 · /policy 策略 · /compact 压缩 · /fork Fork · /interrupt 中断 · /rename 重命名",
      );
    }
  }

  if (!conversation) {
    return (
      <section>
        <ErrorNotice message={error} />
        <Loading>加载对话中...</Loading>
      </section>
    );
  }

  return (
    <section className="conversation-page">
      <div className="page-context">
        <Link to={`/projects/${projectId}/chat`} className="btn back-link">
          返回对话列表
        </Link>
      </div>
      <div className="page-header">
        <div>
          <p className="page-kicker">项目对话</p>
          <h1>{conversation.title || "未命名对话"}</h1>
        </div>
        <div className="page-actions">
          <span className={`badge badge-${websocket.connected ? "success" : "warning"}`}>
            {websocket.connected ? "实时连接" : "重连中..."}
          </span>
          <span className="badge badge-neutral">{conversation.status}</span>
        </div>
      </div>

      <div className="conversation-toolbar">
        <button type="button" disabled={busy} onClick={interrupt}>
          中断
        </button>
        <button type="button" disabled={busy} onClick={fork}>
          Fork
        </button>
        <button type="button" disabled={busy} onClick={compact}>
          压缩
        </button>
        <button type="button" onClick={() => setShowPolicy((current) => !current)}>
          策略
        </button>
        <button type="button" onClick={() => setShowActivity((current) => !current)}>
          日志
        </button>
        <button type="button" onClick={() => setShowCommands((current) => !current)}>
          快捷指令
        </button>
      </div>

      {showCommands ? (
        <QuickCommandPalette
          onRun={runQuickCommand}
          onClose={() => setShowCommands(false)}
        />
      ) : null}

      {renaming ? (
        <div className="conversation-rename">
          <input
            aria-label="对话标题"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder="输入新标题"
          />
          <button type="button" className="btn-primary" onClick={renameConversation}>
            保存标题
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
      <SuccessNotice message={message} />

      {clarification ? (
        <ClarificationInline
          clarification={clarification}
          onAnswer={answerClarification}
          busy={busy}
        />
      ) : null}

      {pendingApprovals.map((approval) => (
        <ApprovalInline
          key={approval.id}
          approval={approval}
          busy={busy}
          onDecide={(decision) => decideApproval(approval.id, decision)}
        />
      ))}

      <MessageTimeline items={items} />

      {showActivity ? <ActivityInspector events={events} /> : null}

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
          <div className="actions">
            <button
              type="button"
              onClick={() => setShowFilePicker((current) => !current)}
            >
              引用文件
            </button>
            <button className="btn-primary" type="button" disabled={busy || !text.trim()} onClick={send}>
              {busy ? "处理中..." : "发送"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MessageTimeline({ items }: { items: ConversationItem[] }) {
  if (items.length === 0) {
    return (
      <div className="card empty-state">
        <h2>开始对话</h2>
        <p className="muted">发送一条消息后，Codex 的输出会显示在这里。</p>
      </div>
    );
  }

  return (
    <div className="conversation-timeline">
      {items.map((item) => (
        <ConversationItemBlock key={item.id} item={item} />
      ))}
    </div>
  );
}

function ConversationItemBlock({ item }: { item: ConversationItem }) {
  const text = textFromItem(item);

  if (item.itemType === "userMessage") {
    return (
      <div className="conversation-message user-message">
        <div className="message-role">你</div>
        <div className="message-body">{text}</div>
        {Array.isArray(item.payload?.mentions) ? (
          <div className="conversation-mentions">
            {(item.payload.mentions as Array<{ name: string; path: string }>).map(
              (mention) => (
                <span key={mention.path} className="mention-chip">
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
    const content = Array.isArray(item.payload?.content)
      ? (item.payload.content as string[]).join("\n")
      : text;
    return (
      <details className="reasoning-block">
        <summary>思考过程</summary>
        <pre className="conversation-pre">{content}</pre>
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
    return (
      <div className="token-usage muted">
        token 用量更新: {JSON.stringify(item.payload)}
      </div>
    );
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
