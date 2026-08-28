import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  api,
  type BugfixTask,
  type ClarificationQuestion,
  type DeliveryReport,
  type DiffResult,
  type PendingClarification,
  type Project,
  type TaskAttention,
  type TaskDetail,
  type ValidationCommand,
  type ValidationOutcome,
} from "./api.js";
import { useHarnessEvents } from "./use-harness-events.js";

type BadgeTone = "neutral" | "active" | "success" | "warning" | "danger";

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "草稿", tone: "neutral" },
  PREPARING_WORKSPACE: { label: "准备中", tone: "active" },
  ANALYZING: { label: "分析中", tone: "active" },
  WAITING_FOR_PLAN_APPROVAL: { label: "待确认计划", tone: "warning" },
  IMPLEMENTING: { label: "实施中", tone: "active" },
  VALIDATING: { label: "验证中", tone: "active" },
  WAITING_FOR_ACCEPTANCE: { label: "待验收", tone: "warning" },
  ACCEPTED: { label: "已验收", tone: "success" },
  BLOCKED: { label: "受阻", tone: "danger" },
  FAILED: { label: "失败", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
  REJECTED: { label: "已拒绝", tone: "danger" },
};

const DEFAULT_PROJECT_FIELDS = {
  instructionSources: "AGENTS.md",
  validationCommands: JSON.stringify(
    [
      {
        id: "test",
        label: "运行测试",
        command: ["npm", "test"],
        timeoutSec: 300,
      },
      {
        id: "typecheck",
        label: "类型检查",
        command: ["npm", "run", "typecheck"],
        timeoutSec: 300,
      },
    ],
    null,
    2,
  ),
  allowedPaths: "src/\ntest/",
  forbiddenPaths: "node_modules/",
};

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function PageHeader({
  kicker,
  title,
  actions,
}: {
  kicker?: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {kicker ? <p className="page-kicker">{kicker}</p> : null}
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      <span className="fact-value">{value || "—"}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="icon icon-check" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg className="icon icon-cross" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="icon icon-warning" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2 15 14H1L8 2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 6v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice notice-error" role="alert">
      {message}
    </div>
  ) : null;
}

function SuccessNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice notice-success" role="status">
      {message}
    </div>
  ) : null;
}

function ClarificationPanel({
  clarification,
  onAnswered,
}: {
  clarification: PendingClarification;
  onAnswered: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(skip = false) {
    setBusy(true);
    setError("");
    try {
      if (skip) {
        await api.answerClarification(clarification.taskId, {});
        onAnswered();
        return;
      }

      const answers: Record<string, { answers: string[] }> = {};
      for (const question of clarification.questions) {
        const value = String(values[question.id] ?? "").trim();
        if (!value) {
          throw new Error(`请先回答：${question.question}`);
        }
        answers[question.id] = { answers: [value] };
      }
      await api.answerClarification(clarification.taskId, answers);
      onAnswered();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function renderQuestion(question: ClarificationQuestion) {
    const value = values[question.id] ?? "";
    if (question.options?.length) {
      const selectedOther = otherOpen[question.id] ?? false;
      const selectedKnownOption = question.options.some(
        (option) => option.label === value,
      );
      return (
        <div className="field" key={question.id}>
          <label>
            {question.question}
            <select
              aria-label={question.question}
              value={selectedOther ? "__other__" : selectedKnownOption ? value : ""}
              onChange={(event) => {
                if (event.target.value === "__other__") {
                  setOtherOpen((current) => ({ ...current, [question.id]: true }));
                  setValues((current) => ({ ...current, [question.id]: "" }));
                  return;
                }
                setOtherOpen((current) => ({ ...current, [question.id]: false }));
                setValues((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }));
              }}
            >
              <option value="">请选择</option>
              {question.options.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                  {option.description ? ` — ${option.description}` : ""}
                </option>
              ))}
              {question.isOther ? <option value="__other__">其他</option> : null}
            </select>
          </label>
          {question.isOther && selectedOther ? (
            <input
              type={question.isSecret ? "password" : "text"}
              aria-label={`${question.question} 其他回答`}
              placeholder="其他回答"
              value={value}
              onChange={(event) =>
                setValues((current) => ({ ...current, [question.id]: event.target.value }))
              }
            />
          ) : null}
        </div>
      );
    }

    return (
      <label className="field" key={question.id}>
        {question.question}
        <textarea
          aria-label={question.question}
          value={value}
          placeholder={question.header || "请输入"}
          onChange={(event) =>
            setValues((current) => ({ ...current, [question.id]: event.target.value }))
          }
        />
      </label>
    );
  }

  return (
    <div className="card notice-card">
      <div className="card-head">
        <h2>分析阶段需要补充信息</h2>
      </div>
      <p className="muted">
        Codex 在分析时遇到不明确的信息，请根据实际情况补充后继续。
      </p>
      {clarification.questions.map(renderQuestion)}
      <ErrorNotice message={error} />
      <div className="form-actions">
        <button
          className="btn-primary"
          type="button"
          disabled={busy}
          onClick={() => submit(false)}
        >
          {busy ? "提交中..." : "提交并继续分析"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(true)}
        >
          {busy ? "提交中..." : "暂时跳过，让 Codex 继续推断"}
        </button>
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

function DiffBlock({ value }: { value: string }) {
  const rows = value.split("\n");
  return (
    <div className="diff" role="region" aria-label="代码差异">
      {rows.map((line, index) => {
        const cls =
          line.startsWith("+++") || line.startsWith("---")
            ? "diff-meta"
            : line.startsWith("@@")
              ? "diff-hunk"
              : line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-del"
                  : "";
        return (
          <div key={index} className={`diff-line${cls ? ` ${cls}` : ""}`}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

function riskTone(level?: string): BadgeTone {
  const value = (level ?? "").toLowerCase();
  if (value === "high" || value === "critical") return "danger";
  if (value === "medium") return "warning";
  return "neutral";
}

function validationTone(status: string): BadgeTone {
  if (status === "passed") return "success";
  if (status === "failed" || status === "timeout") return "danger";
  return "neutral";
}

function fileTone(status: string): BadgeTone {
  if (status === "added" || status === "untracked") return "success";
  if (status === "deleted") return "danger";
  if (status === "modified" || status === "renamed") return "warning";
  return "neutral";
}

function fileStatusLabel(status: string): string {
  switch (status) {
    case "added":
      return "新增";
    case "modified":
      return "修改";
    case "deleted":
      return "删除";
    case "untracked":
      return "新增";
    case "renamed":
      return "移动/重命名";
    default:
      return status;
  }
}

function validationStatusLabel(status: string): string {
  switch (status) {
    case "passed":
      return "通过";
    case "failed":
      return "未通过";
    case "timeout":
      return "超时";
    case "skipped":
      return "跳过";
    default:
      return status;
  }
}

function approvalRiskLabel(risk: string): string {
  if (risk === "autoAllow") return "自动允许";
  if (risk === "prompt") return "需要确认";
  if (risk === "deny") return "已禁止";
  return risk;
}

function approvalSummary(item: Record<string, unknown>): string {
  const method = String(item.method ?? "");
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  if (method === "command") {
    return `AI 想运行命令：${String(payload.command ?? "")}`;
  }
  if (method === "file") {
    const action =
      payload.action === "delete"
        ? "删除"
        : payload.action === "write"
          ? "修改"
          : "读取";
    return `AI 想${action}文件：${String(payload.path ?? "")}`;
  }
  if (method === "network") {
    return `AI 想访问网络${payload.host ? `：${String(payload.host)}` : ""}`;
  }
  if (method === "permissions") {
    return `AI 想申请额外权限${payload.reason ? `：${String(payload.reason)}` : ""}`;
  }
  return "AI 发起了一个操作请求";
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseValidationCommands(value: string): ValidationCommand[] {
  const text = value.trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as ValidationCommand[];
    }
    return [parsed as ValidationCommand];
  } catch {
    return lines(text).map((command, index) => ({
      id: `command-${index}`,
      label: command,
      command: [command],
      timeoutSec: 300,
    }));
  }
}

export function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="Bugfix Harness 首页">
            <span className="brand-mark" aria-hidden="true">
              B
            </span>
            <span className="brand-name">Bugfix Harness</span>
          </Link>
          <nav className="topnav" aria-label="主导航">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              项目
            </NavLink>
            <NavLink
              to="/tasks/new"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              新建任务
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              设置
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <PageHeader
        kicker="工作台"
        title="本地项目"
        actions={
          <Link to="/projects/new" className="btn btn-primary">
            添加项目
          </Link>
        }
      />
      <ErrorNotice message={error} />
      {loading ? (
        <Loading />
      ) : projects.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">暂无项目，请先添加一个本地 Git 仓库。</p>
        </div>
      ) : (
        <div className="card">
          <div className="list">
            {projects.map((project) => (
              <div key={project.id} className="list-item">
                <div className="list-item-main">
                  <Link to={`/projects/${project.id}`} className="list-item-title">
                    {project.name}
                  </Link>
                  <span className="list-item-meta">{project.repoPath}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [repoPath, setRepoPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repoError, setRepoError] = useState("");
  const [picking, setPicking] = useState(false);

  async function pickPath() {
    setPicking(true);
    setError("");
    setRepoError("");
    try {
      const { path, isGitRepo, repoName } = await api.pickDirectory();
      if (!path) return;
      setRepoPath(path);
      if (repoName) setProjectName(repoName);
      if (!isGitRepo) {
        setRepoError("该目录不是 Git 仓库，请选择包含 .git 的仓库根目录。");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPicking(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api.createProject({
        name: String(form.get("name")),
        repoPath: String(form.get("repoPath")),
        instructionSources: lines(String(form.get("instructionSources") ?? "")),
        validationCommands: parseValidationCommands(
          String(form.get("validationCommands") ?? ""),
        ),
        allowedPaths: lines(String(form.get("allowedPaths") ?? "")),
        forbiddenPaths: lines(String(form.get("forbiddenPaths") ?? "")),
      });
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader kicker="项目" title="添加项目" />
      <form className="form" onSubmit={submit}>
        <div className="card form-card">
          <label className="field">
            名称
            <input
              name="name"
              required
              aria-label="名称"
              placeholder="例如：web-service"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
            />
          </label>
          <div className="field">
            <label htmlFor="repoPath">Git 仓库路径</label>
            <div className="input-group">
              <input
                id="repoPath"
                name="repoPath"
                required
                aria-label="Git 仓库路径"
                placeholder="/path/to/repo"
                value={repoPath}
                onChange={(event) => {
                  setRepoPath(event.target.value);
                  setRepoError("");
                }}
              />
              <button type="button" className="btn" onClick={pickPath} disabled={picking}>
                {picking ? "选择中..." : "选择目录"}
              </button>
            </div>
            {repoError ? <span className="field-error">{repoError}</span> : null}
          </div>
          <label className="field">
            规范来源（每行一个路径）
            <textarea
              name="instructionSources"
              aria-label="规范来源"
              defaultValue={DEFAULT_PROJECT_FIELDS.instructionSources}
            />
          </label>
          <label className="field">
            验证命令（JSON 数组，或每行一条命令）
            <textarea
              name="validationCommands"
              aria-label="验证命令"
              defaultValue={DEFAULT_PROJECT_FIELDS.validationCommands}
            />
            <span className="field-hint">可填写 JSON 数组，或每行一条命令。</span>
          </label>
          <label className="field">
            允许修改路径（每行一个）
            <textarea
              name="allowedPaths"
              aria-label="允许修改路径"
              defaultValue={DEFAULT_PROJECT_FIELDS.allowedPaths}
            />
          </label>
          <label className="field">
            禁止修改路径（每行一个）
            <textarea
              name="forbiddenPaths"
              aria-label="禁止修改路径"
              defaultValue={DEFAULT_PROJECT_FIELDS.forbiddenPaths}
            />
          </label>
        </div>
        <ErrorNotice message={error} />
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  const [tasks, setTasks] = useState<BugfixTask[]>([]);
  const [attentions, setAttentions] = useState<Record<string, TaskAttention>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .listTasks(id)
      .then(async (items) => {
        const next: Record<string, TaskAttention> = {};
        await Promise.all(
          items.map(async (task) => {
            try {
              next[task.id] = await api.getAttention(task.id);
            } catch {
              // Attention is optional for the list view.
            }
          }),
        );
        if (!cancelled) {
          setTasks(items);
          setAttentions(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <section>
      <PageHeader
        kicker="项目"
        title="项目任务"
        actions={
          <Link to={`/tasks/new?projectId=${id}`} className="btn btn-primary">
            新建 Bugfix 任务
          </Link>
        }
      />
      <ErrorNotice message={error} />
      {tasks.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">暂无任务。</p>
        </div>
      ) : (
        <div className="card">
          <div className="list">
            {tasks.map((task) => (
              <div key={task.id} className="list-item">
                <div className="list-item-main">
                  <Link to={`/tasks/${task.id}`} className="list-item-title">
                    {task.title}
                  </Link>
                  <span className="list-item-meta">{task.id}</span>
                </div>
                <StatusBadge status={task.status} />
                {attentions[task.id] &&
                (attentions[task.id].clarification ||
                  attentions[task.id].planApproval?.status === "PENDING" ||
                  attentions[task.id].pendingApprovals > 0 ||
                  attentions[task.id].validation.failed +
                    attentions[task.id].validation.timeout >
                    0) ? (
                  <Badge tone="warning">待处理</Badge>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function NewTaskPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const extra = String(form.get("extra") ?? "").trim();
    try {
      const result = await api.createTask({
        projectId: String(form.get("projectId")),
        bugDescription: String(form.get("bugDescription")).trim(),
        reproductionSteps: extra || undefined,
        relatedFiles: [],
        acceptanceCriteria: [],
        constraints: [],
      });
      navigate(`/tasks/${result.task.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader kicker="任务" title="新建 Bugfix 任务" />
      <form className="form" onSubmit={submit}>
        <div className="card form-card">
          <label className="field">
            项目
            <select
              name="projectId"
              required
              aria-label="项目"
              defaultValue={params.get("projectId") ?? ""}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            问题描述
            <textarea
              name="bugDescription"
              required
              aria-label="问题描述"
              placeholder="用你自己的话描述遇到了什么问题。例如：登录页点击提交后一直转圈，但提示信息不完整。"
            />
            <span className="field-hint">
              标题会根据问题描述自动生成，其他信息可在下方补充。
            </span>
          </label>
          <label className="field">
            补充信息（选填）
            <textarea
              name="extra"
              aria-label="补充信息"
              placeholder="可选填写：复现步骤、当前行为、期望行为、日志、相关文件、验收条件等"
            />
            <span className="field-hint">
              非必填。建议提供能帮助定位问题的信息，不填写也能创建任务。
            </span>
          </label>
        </div>
        <ErrorNotice message={error} />
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? "创建中..." : "创建"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [clarification, setClarification] = useState<PendingClarification | null>(null);
  const [attention, setAttention] = useState<TaskAttention | null>(null);
  const { connected, events } = useHarnessEvents(id);

  async function load() {
    setError("");
    try {
      setDetail(await api.getTask(id!));
    } catch (err) {
      setError((err as Error).message);
    }
    try {
      setAttention(await api.getAttention(id!));
    } catch {
      setAttention(null);
    }
  }

  async function loadAttention() {
    try {
      setAttention(await api.getAttention(id!));
    } catch {
      setAttention(null);
    }
  }

  async function loadClarification() {
    try {
      setClarification(await api.getClarification(id!));
    } catch {
      setClarification(null);
    }
  }

  const clarificationEvent = events
    .filter(
      (event) =>
        event.type === "clarification.requested" ||
        event.type === "clarification.answered",
    )
    .at(-1);

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    loadClarification();
  }, [id, clarificationEvent]);

  useEffect(() => {
    const active = [
      "PREPARING_WORKSPACE",
      "ANALYZING",
      "IMPLEMENTING",
      "VALIDATING",
    ].includes(detail?.task.status ?? "");
    if (!active) return;
    const timer = setInterval(() => {
      load();
    }, 4000);
    return () => clearInterval(timer);
  }, [detail?.task.status]);

  async function run(action: () => Promise<unknown>, label: string) {
    setBusy(label);
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(`${label} 成功`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function cancelTask() {
    if (!window.confirm("确定取消该任务吗？正在执行的分析或实施会被中断。")) {
      return;
    }
    await run(() => api.cancelTask(id!), "取消任务");
  }

  async function deleteTask() {
    if (!detail) {
      return;
    }
    if (!window.confirm("确定删除该任务吗？关联的 worktree 和工作记录也会被清理。")) {
      return;
    }
    setBusy("删除任务");
    setMessage("");
    setError("");
    try {
      await api.deleteTask(id!);
      navigate(`/projects/${detail.task.projectId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }

  if (error && !detail) {
    return <ErrorNotice message={`加载失败：${error}`} />;
  }
  if (!detail) {
    return <Loading />;
  }

  const status = detail.task.status;
  const canPrepareWorktree = status === "DRAFT" || status === "PREPARING_WORKSPACE";
  const canAnalyze =
    status === "DRAFT" ||
    status === "PREPARING_WORKSPACE" ||
    status === "WAITING_FOR_PLAN_APPROVAL";
  const canImplement = status === "IMPLEMENTING";
  const canCancel = [
    "DRAFT",
    "PREPARING_WORKSPACE",
    "ANALYZING",
    "WAITING_FOR_PLAN_APPROVAL",
    "IMPLEMENTING",
    "VALIDATING",
    "WAITING_FOR_ACCEPTANCE",
    "BLOCKED",
  ].includes(status);

  return (
    <section>
      <PageHeader
        kicker="任务详情"
        title={detail.task.title}
        actions={<StatusBadge status={detail.task.status} />}
      />

      {attention &&
      (attention.clarification ||
        attention.planApproval?.status === "PENDING" ||
        attention.pendingApprovals > 0 ||
        attention.validation.failed + attention.validation.timeout > 0) ? (
        <div className="card">
          <div className="card-head">
            <h2>待你处理</h2>
          </div>
          <ul className="checklist">
            {attention.clarification ? (
              <li className="check-item">
                <WarningIcon />
                <span>Codex 正在等待你补充信息，请完成下方提问。</span>
              </li>
            ) : null}
            {attention.planApproval?.status === "PENDING" ? (
              <li className="check-item">
                <WarningIcon />
                <span>
                  修复计划已生成，等待你确认。
                  <Link to={`/tasks/${id}/plan`}>查看计划</Link>
                </span>
              </li>
            ) : null}
            {attention.pendingApprovals > 0 ? (
              <li className="check-item">
                <WarningIcon />
                <span>
                  有 {attention.pendingApprovals} 个操作等待审批。
                  <Link to={`/tasks/${id}/approvals`}>查看审批</Link>
                </span>
              </li>
            ) : null}
            {attention.validation.failed + attention.validation.timeout > 0 ? (
              <li className="check-item">
                <WarningIcon />
                <span>
                  有检查未通过，请查看结果并决定下一步。
                  <Link to={`/tasks/${id}/diff`}>查看检查</Link>
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="card">
        <div className="meta-grid">
          <div className="meta-cell">
            <span className="meta-label">项目 ID</span>
            <span className="mono">{detail.task.projectId}</span>
          </div>
          <div className="meta-cell">
            <span className="meta-label">创建时间</span>
            <span>{formatDate(detail.task.createdAt)}</span>
          </div>
          <div className="meta-cell">
            <span className="meta-label">更新时间</span>
            <span>{formatDate(detail.task.updatedAt)}</span>
          </div>
          <div className="meta-cell">
            <span className="meta-label">验收条件</span>
            <span>{detail.task.acceptanceCriteria.length} 条</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>工作流</h2>
        </div>
        <div className="actions">
          <Link to={`/tasks/${id}/plan`} className="btn">
            计划确认
          </Link>
          <Link to={`/tasks/${id}/approvals`} className="btn">
            操作审批
          </Link>
          <Link to={`/tasks/${id}/diff`} className="btn">
            变更与检查
          </Link>
          <Link to={`/tasks/${id}/report`} className="btn">
            验收报告
          </Link>
        </div>
        <div className="divider" />
        <div className="actions">
          <button
            className="btn-primary"
            disabled={!canAnalyze || Boolean(busy)}
            title={canAnalyze ? "" : "当前状态不可开始分析"}
            onClick={() => run(() => api.analyze(id!), "开始修复")}
          >
            开始修复
          </button>
          <button
            className="btn-primary"
            disabled={!canImplement || Boolean(busy)}
            title={canImplement ? "" : "请先批准修复计划"}
            onClick={() => run(() => api.implement(id!), "开始实施")}
          >
            开始实施
          </button>
        </div>
        <div className="divider" />
        <div className="actions">
          {canCancel ? (
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={cancelTask}
            >
              取消任务
            </button>
          ) : null}
          <button
            type="button"
            className="btn-danger"
            disabled={Boolean(busy)}
            onClick={deleteTask}
          >
            删除任务
          </button>
        </div>
      </div>

      {clarification ? (
        <ClarificationPanel
          clarification={clarification}
          onAnswered={() => {
            setClarification(null);
            loadAttention();
            loadClarification();
            load();
          }}
        />
      ) : null}

      {busy && <Loading>{busy}...</Loading>}
      <ErrorNotice message={error} />
      <SuccessNotice message={message} />

      <section className="card">
        <div className="card-head">
          <h2>实时事件</h2>
          <Badge tone={connected ? "success" : "neutral"}>
            {connected ? "已连接" : "未连接"}
          </Badge>
        </div>
        {events.length === 0 ? (
          <p className="muted">暂无实时事件。</p>
        ) : (
          <ul className="event-list">
            {events.map((event, index) => (
              <li key={index} className="event-item">
                <span className="event-time">{event.emittedAt}</span>
                <span className="event-type">{event.type}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

export function PlanPage() {
  const { id } = useParams();
  const [plan, setPlan] = useState<any>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [question, setQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    api.getPlan(id!).then(setPlan).catch(() => setPlan(null));
  }, [id]);

  async function decide(action: () => Promise<unknown>, label: string) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function askQuestion() {
    setAsking(true);
    setError("");
    setAiAnswer("");
    try {
      const result = await api.askPlanQuestion(id!, question);
      setAiAnswer(result.answer);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section>
      <PageHeader kicker="审查" title="修复计划" />
      {!plan ? (
        <div className="card empty-state">
          <p className="muted">当前没有待确认的修复计划。</p>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <h2>{plan.content?.problemSummary ?? "问题摘要"}</h2>
          </div>
          <div className="facts">
            <Fact label="它认为问题在哪里" value={plan.content?.rootCauseHypothesis} />
            <Fact label="准备怎么改" value={plan.content?.fixStrategy} />
            <Fact label="为什么这样判断" value={(plan.content?.evidence ?? []).join("；")} />
            <Fact
              label="可能影响哪些文件"
              value={(plan.content?.proposedFiles ?? []).join("、")}
            />
            <Fact label="需要注意" value={(plan.content?.risks ?? []).join("；") || "无"} />
            <Fact
              label="还没完全确定"
              value={(plan.content?.openQuestions ?? []).join("；") || "无"}
            />
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>先问 AI 一个问题</h2>
        </div>
        <p className="muted">看不懂计划，或想确认某个影响时，可以先问清楚再决定。</p>
        <label className="field">
          你的问题
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：这个修改会影响其他功能吗？"
          />
        </label>
        <div className="form-actions">
          <button
            type="button"
            disabled={!question.trim() || asking || Boolean(busy)}
            onClick={askQuestion}
          >
            {asking ? "询问中..." : "问 AI"}
          </button>
        </div>
        {aiAnswer ? (
          <div className="divider" />
        ) : null}
        {aiAnswer ? <p className="ai-answer">{aiAnswer}</p> : null}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>审批决定</h2>
        </div>
        <label className="field">
          审批意见
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="批准或退回时可附上说明"
          />
        </label>
        <div className="divider" />
        <div className="actions">
          <button
            className="btn-primary"
            disabled={!plan || Boolean(busy)}
            onClick={() => decide(() => api.approvePlan(id!, comment), "批准")}
          >
            批准
          </button>
          <button
            className="btn-danger"
            disabled={!plan || Boolean(busy)}
            onClick={() => decide(() => api.rejectPlan(id!, comment), "退回")}
          >
            退回
          </button>
        </div>
      </div>
      <ErrorNotice message={error} />
    </section>
  );
}

export function ApprovalsPage() {
  const { id } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [showPayload, setShowPayload] = useState<string | null>(null);

  async function load() {
    setError("");
    try {
      setItems(await api.listApprovals(id!));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  return (
    <section>
      <PageHeader kicker="审查" title="操作审批" />
      <ErrorNotice message={error} />
      {items.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">暂无审批请求</p>
        </div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="card">
            <div className="card-head">
              <div className="card-title-group">
                <strong>{approvalSummary(item)}</strong>
                <Badge tone={riskTone(item.riskLevel)}>
                  {approvalRiskLabel(item.riskLevel)}
                </Badge>
              </div>
              <Badge tone={item.decision ? "neutral" : "warning"}>
                {item.decision ?? "待处理"}
              </Badge>
            </div>
            <p className="muted">
              该操作需要你确认后才能继续。批准表示允许 AI 执行；拒绝会阻止该操作。
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setShowPayload((current) => (current === item.id ? null : item.id))
                }
              >
                {showPayload === item.id ? "收起技术详情" : "查看技术详情"}
              </button>
            </div>
            {showPayload === item.id ? (
              <pre className="code">{JSON.stringify(item.payload, null, 2)}</pre>
            ) : null}
            {!item.decision && (
              <div className="actions">
                <button
                  className="btn-primary"
                  onClick={() => api.decideApproval(id!, item.id, "accept").then(load)}
                >
                  允许
                </button>
                <button
                  className="btn-danger"
                  onClick={() => api.decideApproval(id!, item.id, "decline").then(load)}
                >
                  拒绝
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

export function DiffPage() {
  const { id } = useParams();
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [validations, setValidations] = useState<ValidationOutcome[]>([]);
  const [error, setError] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [openOutput, setOpenOutput] = useState<string | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);
  const [continueMessage, setContinueMessage] = useState("");

  async function loadDiff() {
    try {
      setDiff(await api.getDiff(id!));
    } catch {
      setDiff(null);
    }
  }

  async function loadValidations() {
    try {
      setValidations(await api.listValidations(id!));
    } catch {
      setValidations([]);
    }
  }

  useEffect(() => {
    loadDiff();
    loadValidations();
  }, [id]);

  async function validate() {
    setError("");
    try {
      setValidations(await api.runValidations(id!));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function continueFix() {
    setContinueBusy(true);
    setError("");
    setContinueMessage("");
    try {
      await api.continueFix(id!);
      setContinueMessage("已根据失败结果继续修复，验证将自动运行。");
      await loadDiff();
      await loadValidations();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setContinueBusy(false);
    }
  }

  return (
    <section>
      <PageHeader
        kicker="检查"
        title="变更与检查"
        actions={
          <button className="btn-primary" onClick={validate}>
            运行检查
          </button>
        }
      />
      <ErrorNotice message={error} />
      <SuccessNotice message={continueMessage} />

      {diff && (
        <div className="card">
          <div className="card-head">
            <h2>本次改动</h2>
          </div>
          <div className="facts">
            <Fact label="涉及位置" value={`${diff.stats.total} 个文件`} />
            <Fact
              label="新增"
              value={`${diff.stats.added + diff.stats.untracked} 个文件`}
            />
            <Fact label="修改" value={`${diff.stats.modified} 个文件`} />
            <Fact
              label="移动/重命名"
              value={`${diff.stats.renamed} 个文件`}
            />
            <Fact label="删除" value={`${diff.stats.deleted} 个文件`} />
          </div>
          <div className="divider" />
          <button
            type="button"
            className="btn"
            onClick={() => setShowFiles((current) => !current)}
          >
            {showFiles ? "收起具体文件" : "查看具体文件"}
          </button>
          {showFiles ? (
            <ul className="file-list">
              {diff.files.map((file) => (
                <li key={file.path} className="file-item">
                  <Badge tone={fileTone(file.status)}>
                    {fileStatusLabel(file.status)}
                  </Badge>
                  <span className="mono">{file.path}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {validations.length > 0 && (
        <div className="stack">
          {validations.map((item) => (
            <div key={item.command.id} className="card card-compact">
              <div className="card-head">
                <div className="card-title-group">
                  <strong>{item.command.label}</strong>
                </div>
                <Badge tone={validationTone(item.status)}>
                  {validationStatusLabel(item.status)}
                </Badge>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    setOpenOutput((current) =>
                      current === item.command.id ? null : item.command.id,
                    )
                  }
                >
                  {openOutput === item.command.id ? "收起输出" : "查看输出"}
                </button>
              </div>
              {openOutput === item.command.id ? (
                <>
                  {item.stdout ? <pre className="code">{item.stdout}</pre> : null}
                  {item.stderr ? <pre className="code">{item.stderr}</pre> : null}
                  {item.skipReason ? <p className="muted">{item.skipReason}</p> : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {validations.some(
        (item) => item.status === "failed" || item.status === "timeout",
      ) ? (
        <div className="card">
          <div className="card-head">
            <h2>检查未通过</h2>
          </div>
          <p className="muted">
            失败原因见上方各项检查输出。点击下方按钮，Codex 会带着这些失败输出继续修改，并在完成后自动重新验证。
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn-primary"
              disabled={continueBusy}
              onClick={continueFix}
            >
              {continueBusy ? "正在继续修复..." : "根据失败结果继续修复"}
            </button>
            <Link to={`/tasks/${id}`} className="btn">
              返回任务详情处理
            </Link>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <h2>代码差异（技术细节）</h2>
          <button
            type="button"
            className="btn"
            onClick={() => setShowDiff((current) => !current)}
          >
            {showDiff ? "收起代码差异" : "查看代码差异"}
          </button>
        </div>
        {showDiff ? (
          <DiffBlock value={diff?.unifiedDiff || "暂无代码差异"} />
        ) : (
          <p className="muted">默认收起，适合开发人员或需要定位问题时再展开查看。</p>
        )}
      </div>
    </section>
  );
}

export function ReportPage() {
  const { id } = useParams();
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");

  async function build() {
    setError("");
    try {
      setReport(await api.buildReport(id!));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function decide(action: () => Promise<unknown>, label: string) {
    setDecisionBusy(label);
    setError("");
    setDecisionMessage("");
    try {
      await action();
      setDecisionMessage(
        label === "通过"
          ? "已标记为通过。"
          : label === "需要再改"
            ? "已退回修改，Codex 会继续处理。"
            : "已标记为不采用。",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDecisionBusy("");
    }
  }

  return (
    <section>
      <PageHeader
        kicker="交付"
        title="验收报告"
        actions={
          <button className="btn-primary" onClick={build}>
            生成验收报告
          </button>
        }
      />

      <div className="card">
        <div className="card-head">
          <h2>你的决定</h2>
        </div>
        <p className="muted">
          报告生成后，请按自己的预期判断结果是否可用。不确定时可以选择“需要再改”。
        </p>
        <label className="field">
          补充说明（选填）
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="例如：还有哪一步不符合预期，或希望改成什么样"
          />
        </label>
        <div className="divider" />
        <div className="actions">
          <button
            className="btn-primary"
            disabled={!report || Boolean(decisionBusy)}
            onClick={() => decide(() => api.acceptTask(id!), "通过")}
          >
            通过
          </button>
          <button
            disabled={!report || Boolean(decisionBusy)}
            onClick={() => decide(() => api.returnTask(id!, comment), "需要再改")}
          >
            需要再改
          </button>
          <button
            className="btn-danger"
            disabled={!report || Boolean(decisionBusy)}
            onClick={() => decide(() => api.rejectTask(id!, comment), "不采用")}
          >
            不采用
          </button>
        </div>
      </div>

      <ErrorNotice message={error} />
      <SuccessNotice message={decisionMessage} />

      {report ? (
        <>
          <div className="card">
            <div className="card-head">
              <h2>{report.taskGoal || "本次修复结果"}</h2>
            </div>
            <div className="facts">
              <Fact label="发现的问题" value={report.rootCause || "未提供"} />
              <Fact label="修复方式" value={report.implementation || "未提供"} />
              <Fact
                label="自动检查"
                value={
                  report.validationResults.length
                    ? `${report.validationResults.filter((item) => item.status === "passed").length} 项通过，${report.validationResults.filter((item) => item.status !== "passed").length} 项未通过`
                    : "未提供自动检查"
                }
              />
              <Fact
                label="需要你确认"
                value={
                  report.acceptanceChecklist.length
                    ? report.acceptanceChecklist.every((item) => item.satisfied)
                      ? "当前检查项均已满足"
                      : "还有检查项未满足"
                    : "未提供验收条件，请按实际使用结果判断"
                }
              />
            </div>
          </div>

          {report.acceptanceChecklist.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <h2>结果清单</h2>
              </div>
              <ul className="checklist">
                {report.acceptanceChecklist.map((item) => (
                  <li key={item.criterion} className="check-item">
                    {item.satisfied ? <CheckIcon /> : <CrossIcon />}
                    <span>{item.criterion}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.knownRisks?.length ? (
            <div className="card">
              <div className="card-head">
                <h2>需要注意</h2>
              </div>
              <ul className="checklist">
                {report.knownRisks.map((risk) => (
                  <li key={risk} className="check-item">
                    <WarningIcon />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {report.unverifiedItems?.length ? (
            <div className="card">
              <div className="card-head">
                <h2>暂未确认</h2>
              </div>
              <ul className="checklist">
                {report.unverifiedItems.map((item) => (
                  <li key={item} className="check-item">
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="card">
            <div className="card-head">
              <button
                type="button"
                className="btn"
                onClick={() => setShowTechnicalDetails((current) => !current)}
              >
                {showTechnicalDetails ? "收起技术细节" : "查看技术细节"}
              </button>
            </div>
            {showTechnicalDetails ? (
              <div className="facts">
                <Fact
                  label="修改文件"
                  value={report.modifiedFiles.join("、") || "无"}
                />
                <Fact
                  label="排查依据"
                  value={report.evidence.join("、") || "无"}
                />
                <Fact
                  label="建议重点查看"
                  value={report.recommendedReviewLocations.join("、") || "无"}
                />
                {report.validationResults.map((item) => (
                  <Fact
                    key={item.commandId}
                    label={item.command.join(" ")}
                    value={item.status}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="card empty-state">
          <p className="muted">尚未生成验收报告，点击右上角“生成报告”开始。</p>
        </div>
      )}
    </section>
  );
}

export function SettingsPage() {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .diagnostics()
      .then(setDiagnostics)
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <section>
      <PageHeader kicker="系统" title="基础设置与 Runtime 诊断" />
      <ErrorNotice message={error} />
      {diagnostics ? (
        <div className="card">
          <div className="facts">
            <Fact label="Codex Runtime" value={String(diagnostics.runtime)} />
            <Fact label="数据目录" value={String(diagnostics.dataHome)} />
          </div>
          <div className="divider" />
          <h3>磁盘状态</h3>
          <pre className="code">{JSON.stringify(diagnostics.disk, null, 2)}</pre>
        </div>
      ) : (
        <Loading />
      )}
    </section>
  );
}
