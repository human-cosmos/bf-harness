import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  api,
  type ApprovalRequestItem,
  type BugfixTask,
  type ClarificationQuestion,
  type DeliveryReport,
  type DiffResult,
  type PendingClarification,
  type Project,
  type ProjectSummary,
  type PromptTemplateKey,
  type PromptTemplateSetting,
  type RemoteCloneJob,
  type TaskAttention,
  type TaskDetail,
  type ValidationCommand,
  type ValidationOutcome,
} from "./api.js";
import {
  decodeGitPath,
  MAX_PROMPT_TEMPLATE_LENGTH,
  type SystemSettings,
} from "@bugfix-harness/shared";
import { useHarnessEvents } from "./use-harness-events.js";
import { useWorkflowState } from "./use-workflow-state.js";
import { TaskShell } from "./TaskShell.js";
import { PageBackLink } from "./PageBackLink.js";
import {
  currentStepForStatus,
  nextActionForState,
  STATUS_META,
  WORKFLOW_STEPS,
} from "./workflow-model.js";

type BadgeTone = "neutral" | "active" | "success" | "warning" | "danger";

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

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const meta =
    (STATUS_META as Record<string, { label: string; tone: BadgeTone }>)[status] ??
    { label: status, tone: "neutral" as BadgeTone };
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

function ListFact({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="fact">
      <span className="fact-label">{label}</span>
      {items.length ? (
        <ul className="checklist fact-list">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="check-item">
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="fact-value">无</span>
      )}
    </div>
  );
}

type ConfirmRequest = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  action: () => void | Promise<void>;
};

function ConfirmDialog({
  request,
  busy,
  onConfirm,
  onCancel,
}: {
  request: ConfirmRequest | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!request) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{request.title}</h2>
        <div className="dialog-message">{request.message}</div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onCancel}
          >
            {request.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            className={request.danger ? "btn-danger" : "btn-primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中..." : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!request) return;
    setBusy(true);
    try {
      await request.action();
      setRequest(null);
    } finally {
      setBusy(false);
    }
  }

  return {
    ask: setRequest,
    confirmDialog: (
      <ConfirmDialog
        request={request}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => {
          if (!busy) setRequest(null);
        }}
      />
    ),
  };
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

export function ErrorNotice({ message }: { message: string }) {
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
  onClose,
}: {
  clarification: PendingClarification;
  onAnswered: () => void;
  onClose?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
        if (value) {
          answers[question.id] = { answers: [value] };
        }
      }
      await api.answerClarification(clarification.taskId, answers);
      onAnswered();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const answeredCount = clarification.questions.filter((question) =>
    String(values[question.id] ?? "").trim(),
  ).length;

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
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="dialog clarification-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clarification-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onClose && !busy) {
            onClose();
          }
        }}
      >
        <div className="card-head">
          <h2 id="clarification-dialog-title">分析阶段需要补充信息</h2>
          {onClose ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
            >
              关闭
            </button>
          ) : null}
        </div>
        <p className="muted">
          Codex 在分析时遇到不明确的信息，请根据实际情况补充后继续。
        </p>
        <div className="clarification-progress">
          <span>
            已填写 {answeredCount} / {clarification.questions.length}
          </span>
          <span className="muted">未填写的项会交给 Codex 继续推断</span>
        </div>
        <div className="clarification-dialog-body">
          {clarification.questions.map(renderQuestion)}
        </div>
        <ErrorNotice message={error} />
        <div className="form-actions">
          <button
            className="btn-primary"
            type="button"
            disabled={busy}
            onClick={() => submit(false)}
          >
            {busy ? "提交中..." : "提交并继续分析（空项按跳过）"}
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
    </div>
  );
}

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{children ?? "加载中..."}</span>
    </div>
  );
}

function ListPagination({
  page,
  totalPages,
  total,
  itemLabel,
  ariaLabel,
  disabled = false,
  onPrevious,
  onNext,
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (total <= 0) return null;

  return (
    <nav className="conversation-pagination" aria-label={ariaLabel}>
      <span className="conversation-pagination-summary">
        第 {page} / {totalPages} 页 · 共 {total} {itemLabel}
      </span>
      <div className="conversation-pagination-actions">
        <button
          type="button"
          className="btn"
          disabled={page <= 1 || disabled}
          onClick={onPrevious}
        >
          上一页
        </button>
        <button
          type="button"
          className="btn"
          disabled={page >= totalPages || disabled}
          onClick={onNext}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}

type DiffRow =
  | { type: "meta"; content: string }
  | { type: "hunk"; content: string }
  | { type: "add"; oldNo: null; newNo: number; content: string }
  | { type: "del"; oldNo: number; newNo: null; content: string }
  | { type: "context"; oldNo: number; newNo: number; content: string };

function parseUnifiedDiff(value: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const raw of value.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      rows.push({ type: "hunk", content: raw });
      continue;
    }

    const isMeta =
      raw.startsWith("+++") ||
      raw.startsWith("---") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("rename ") ||
      raw.startsWith("similarity") ||
      raw.startsWith("old mode") ||
      raw.startsWith("new mode") ||
      raw.startsWith("Binary files") ||
      raw.startsWith("\\ No newline") ||
      raw === "";
    if (isMeta) {
      rows.push({ type: "meta", content: raw });
      continue;
    }

    if (raw.startsWith("+")) {
      rows.push({ type: "add", oldNo: null, newNo, content: raw.slice(1) });
      newNo += 1;
      continue;
    }

    if (raw.startsWith("-")) {
      rows.push({ type: "del", oldNo, newNo: null, content: raw.slice(1) });
      oldNo += 1;
      continue;
    }

    const content = raw.startsWith(" ") ? raw.slice(1) : raw;
    rows.push({ type: "context", oldNo, newNo, content });
    oldNo += 1;
    newNo += 1;
  }

  return rows;
}

function DiffBlock({ value }: { value: string }) {
  const rows = useMemo(() => parseUnifiedDiff(value), [value]);
  return (
    <div className="diff" role="region" aria-label="代码差异">
      {rows.map((row, index) => {
        if (row.type === "hunk" || row.type === "meta") {
          return (
            <div
              key={index}
              className={`diff-line ${row.type === "hunk" ? "diff-hunk" : "diff-meta"}`}
            >
              <span className="diff-line-full">{row.content || " "}</span>
            </div>
          );
        }
        const cls = row.type === "add" ? "diff-add" : row.type === "del" ? "diff-del" : "";
        const sign = row.type === "add" ? "+" : row.type === "del" ? "-" : "";
        return (
          <div key={index} className={`diff-line ${cls}`}>
            <span className="diff-line-num">{row.oldNo ?? ""}</span>
            <span className="diff-line-num">{row.newNo ?? ""}</span>
            <span className="diff-line-sign">{sign}</span>
            <span className="diff-line-code">{row.content || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

function pathFromDiffPathSpec(spec: string, side: "a" | "b"): string | null {
  const decoded = decodeGitPath(spec);
  const prefix = `${side}/`;
  return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : null;
}

// Extracts the `b/` side path from a `diff --git` header. This is a best-effort
// fallback for sections without `---`/`+++` markers (for example binary diffs).
// Normal text sections use the unambiguous `+++ b/` marker below. Note that an
// unquoted path containing the literal substring ` b/` cannot be disambiguated
// from this header alone; such binary files may fall back to the "no diff
// content" message in the viewer.
function bPathFromDiffHeader(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  const unquoted = rest.lastIndexOf(" b/");
  if (unquoted >= 0) return pathFromDiffPathSpec(rest.slice(unquoted + 1), "b");
  const quoted = rest.lastIndexOf(' "b/');
  if (quoted >= 0) return pathFromDiffPathSpec(rest.slice(quoted + 1), "b");
  return null;
}

export function splitUnifiedDiffByFile(value: string) {
  const sections: Array<{ path: string | null; lines: string[] }> = [];
  let current: { path: string | null; lines: string[] } | null = null;

  for (const line of value.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = bPathFromDiffHeader(line);
      current = { path, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      continue;
    }

    if (line.startsWith("+++ b/") || line.startsWith('+++ "b/')) {
      const path = pathFromDiffPathSpec(line.slice("+++ ".length), "b");
      if (path !== null) {
        current.path = path;
      }
    } else if (line.startsWith("--- a/") || line.startsWith('--- "a/')) {
      if (current.path === null) {
        const path = pathFromDiffPathSpec(line.slice("--- ".length), "a");
        if (path !== null) {
          current.path = path;
        }
      }
    }

    current.lines.push(line);
  }

  const resolved = sections
    .filter((section) => section.path !== null)
    .map((section) => ({ path: section.path as string, lines: section.lines }));

  if (resolved.length === 0 && value.trim()) {
    return [{ path: "unified diff", lines: value.split("\n") }];
  }
  return resolved;
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
    const path = String(payload.path ?? "");
    const reason = payload.reason ? `（${String(payload.reason)}）` : "";
    if (payload.action === "delete") return `AI 想删除文件：${path}${reason}`;
    if (payload.action === "write") return `AI 想写入：${path}${reason}`;
    return `AI 想读取文件：${path}${reason}`;
  }
  if (method === "network") {
    return `AI 想访问网络${payload.host ? `：${String(payload.host)}` : ""}`;
  }
  if (method === "permissions") {
    return `AI 想申请额外权限${payload.reason ? `：${String(payload.reason)}` : ""}`;
  }
  return "AI 发起了一个操作请求";
}

export function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function formatBytes(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(1)} ${units[unitIndex]}`;
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCommandLine(value: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const part = match[1] ?? match[2] ?? match[3];
    if (part !== undefined) parts.push(part);
  }
  return parts;
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

function validationCommandText(command: ValidationCommand | undefined) {
  if (!command) return "";
  return Array.isArray(command.command)
    ? command.command.join(" ")
    : String(command.command ?? "");
}

function latestValidationOutcomes(items: ValidationOutcome[]) {
  const latest = new Map<string, ValidationOutcome>();
  for (const item of items) {
    const previous = latest.get(item.command.id);
    if (
      !previous ||
      new Date(item.finishedAt || item.startedAt).getTime() >=
        new Date(previous.finishedAt || previous.startedAt).getTime()
    ) {
      latest.set(item.command.id, item);
    }
  }
  return [...latest.values()].sort((a, b) =>
    String(a.command.label).localeCompare(String(b.command.label), "zh-CN"),
  );
}

function eventSummary(event: { type: string; payload?: unknown }): string {
  const payload = event.payload as Record<string, unknown> | undefined;
  switch (event.type) {
    case "connected":
      return "已连接到实时事件流";
    case "project.created":
      return "项目已创建";
    case "task.created":
      return "任务已创建";
    case "task.status_changed":
      return payload?.status ? `任务状态更新为：${String(payload.status)}` : "任务状态已更新";
    case "clarification.requested":
      return "AI 正在等待你补充信息";
    case "clarification.answered":
      return "补充信息已提交";
    case "plan.approval_requested":
      return "修复计划等待确认";
    case "plan.approved":
      return "修复计划已批准";
    case "plan.rejected":
      return "修复计划已退回";
    case "approval.requested":
      return "有新的操作等待审批";
    case "approval.decided":
      return "操作审批已完成";
    case "validation.completed":
      return "自动检查已完成";
    case "job.started":
      return "后台任务已开始";
    case "job.completed":
      return "后台任务已完成";
    case "job.failed":
      return "后台任务失败";
    default:
      return event.type;
  }
}

function approvalDetails(item: Record<string, unknown>) {
  const method = String(item.method ?? "");
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  if (method === "command") {
    const command = Array.isArray(payload.command)
      ? payload.command.join(" ")
      : String(payload.command ?? "");
    return [
      { label: "命令", value: command || "—" },
      { label: "工作目录", value: String(payload.cwd ?? "—") },
    ];
  }
  if (method === "file") {
    const details = [
      { label: "路径", value: String(payload.path ?? "—") },
      { label: "操作", value: String(payload.action ?? "—") },
    ];
    if (payload.reason) {
      details.push({ label: "说明", value: String(payload.reason) });
    }
    return details;
  }
  if (method === "network") {
    return [
      { label: "主机", value: String(payload.host ?? "—") },
      { label: "端口", value: payload.port ? String(payload.port) : "—" },
    ];
  }
  if (method === "permissions") {
    return [{ label: "申请理由", value: String(payload.reason ?? "—") }];
  }
  return [{ label: "原始请求", value: JSON.stringify(item.payload ?? {}) }];
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // localStorage may be unavailable in some embedded contexts.
    }
  }, [theme]);

  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = nextTheme === "dark" ? "切换到深色模式" : "切换到浅色模式";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(nextTheme)}
    >
      {nextTheme === "dark" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      )}
    </button>
  );
}

export function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="bf-harness 首页">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path
                  d="M5 7a2 2 0 0 1 2-2h8l4 4v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 5v14"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path
                  d="M8.5 9.7v4.6M6.2 12h4.6"
                  stroke="var(--success)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M14.8 12h3.4"
                  stroke="var(--danger)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="brand-name">bf-harness</span>
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
              to="/pending"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              待办
            </NavLink>
            <NavLink
              to="/tasks/new"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              任务
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              设置
            </NavLink>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const { ask, confirmDialog } = useConfirmDialog();
  const PROJECT_PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(projects.length / PROJECT_PAGE_SIZE));
  const pageForRender = Math.min(page, totalPages);
  const visibleProjects = projects.slice(
    (pageForRender - 1) * PROJECT_PAGE_SIZE,
    pageForRender * PROJECT_PAGE_SIZE,
  );

  async function load() {
    setLoading(true);
    try {
      const nextProjects = await api.listProjectSummaries();
      setProjects(nextProjects);
      setPage((current) =>
        Math.min(
          current,
          Math.max(1, Math.ceil(nextProjects.length / PROJECT_PAGE_SIZE)),
        ),
      );
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

  async function deleteProject(project: Project) {
    ask({
      title: "删除项目",
      message: `确定删除项目“${project.name}”吗？其下所有任务和本地工作记录也会被删除。`,
      confirmLabel: "删除",
      danger: true,
      action: async () => {
        setDeletingId(project.id);
        setError("");
        try {
          await api.deleteProject(project.id);
          await load();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setDeletingId("");
        }
      },
    });
  }

  return (
    <section>
      {confirmDialog}
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
        <>
          <div className="card">
            <div className="list">
              {visibleProjects.map((project) => (
                <div key={project.id} className="list-item">
                  <div className="list-item-main">
                    <Link to={`/projects/${project.id}`} className="list-item-title">
                      {project.name}
                    </Link>
                    <span className="list-item-meta">{project.repoPath}</span>
                    <span className="list-item-meta">
                      {project.taskCount} 个任务
                      {project.pendingTaskCount
                        ? ` · ${project.pendingTaskCount} 个待处理`
                        : ""}
                    </span>
                  </div>
                  <div className="actions">
                    <Link to={`/projects/${project.id}`} className="btn">
                      查看项目
                    </Link>
                    <Link
                      to={`/tasks/new?projectId=${project.id}`}
                      className="btn"
                    >
                      新建任务
                    </Link>
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={deletingId === project.id}
                      onClick={() => deleteProject(project)}
                    >
                      {deletingId === project.id ? "删除中..." : "删除"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <ListPagination
            page={pageForRender}
            totalPages={totalPages}
            total={projects.length}
            itemLabel="个项目"
            ariaLabel="项目分页"
            disabled={loading}
            onPrevious={() =>
              setPage((current) => Math.max(1, current - 1))
            }
            onNext={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          />
        </>
      )}
    </section>
  );
}

export function PendingPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<BugfixTask[]>([]);
  const [attentions, setAttentions] = useState<Record<string, TaskAttention>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const projectList = await api.listProjects();
        const [taskList, summaries] = await Promise.all([
          api.listTasks(),
          Promise.all(
            projectList.map((project) =>
              api
                .listTaskAttentionSummaries(project.id)
                .catch(() => ({}) as Record<string, TaskAttention>),
            ),
          ),
        ]);

        if (!cancelled) {
          setProjects(projectList);
          setTasks(taskList);
          setAttentions(Object.assign({}, ...summaries));
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.name ?? projectId.slice(0, 8);

  const pendingTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const attention = attentions[task.id];
        return Boolean(
          attention &&
            (attention.clarification ||
              attention.planApproval?.status === "PENDING" ||
              attention.pendingApprovals > 0 ||
              attention.validation.failed + attention.validation.timeout > 0 ||
              task.status === "WAITING_FOR_ACCEPTANCE"),
        );
      }),
    [attentions, tasks],
  );

  function actionForTask(task: BugfixTask): { label: string; href: string } {
    const attention = attentions[task.id];
    if (attention?.clarification) {
      return { label: "补充信息", href: `/tasks/${task.id}` };
    }
    if (attention?.planApproval?.status === "PENDING") {
      return { label: "确认计划", href: `/tasks/${task.id}/plan` };
    }
    if (attention && attention.pendingApprovals > 0) {
      return { label: `处理 ${attention.pendingApprovals} 项审批`, href: `/tasks/${task.id}/approvals` };
    }
    if (
      attention &&
      attention.validation.failed + attention.validation.timeout > 0
    ) {
      return { label: "处理失败检查", href: `/tasks/${task.id}/diff` };
    }
    if (task.status === "WAITING_FOR_ACCEPTANCE") {
      return { label: "验收结果", href: `/tasks/${task.id}/report` };
    }
    return { label: "查看任务", href: `/tasks/${task.id}` };
  }

  return (
    <section>
      <PageHeader kicker="工作台" title="待办中心" />
      <ErrorNotice message={error} />
      {loading ? (
        <Loading />
      ) : pendingTasks.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">当前没有需要你处理的任务。</p>
        </div>
      ) : (
        <div className="card">
          <div className="list">
            {pendingTasks.map((task) => {
              const action = actionForTask(task);
              return (
                <div key={task.id} className="list-item">
                  <div className="list-item-main">
                    <span className="list-item-meta">{projectName(task.projectId)}</span>
                    <Link to={`/tasks/${task.id}`} className="list-item-title">
                      {task.title}
                    </Link>
                    <span className="list-item-meta">
                      {formatDate(task.updatedAt)} · <StatusBadge status={task.status} />
                    </span>
                  </div>
                  <Link to={action.href} className="btn btn-primary">
                    {action.label}
                  </Link>
                </div>
              );
            })}
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
  const [source, setSource] = useState<"local" | "remote">("local");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [passwordOrToken, setPasswordOrToken] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [cloneJob, setCloneJob] = useState<RemoteCloneJob | null>(null);
  const [projectDefaults, setProjectDefaults] =
    useState<SystemSettings["projectDefaults"] | null>(null);
  const [instructionSourcesText, setInstructionSourcesText] = useState(
    DEFAULT_PROJECT_FIELDS.instructionSources,
  );
  const [allowedPathsText, setAllowedPathsText] = useState(
    DEFAULT_PROJECT_FIELDS.allowedPaths,
  );
  const [forbiddenPathsText, setForbiddenPathsText] = useState(
    DEFAULT_PROJECT_FIELDS.forbiddenPaths,
  );
  const [validationCommands, setValidationCommands] = useState<ValidationCommand[]>(
    () => parseValidationCommands(DEFAULT_PROJECT_FIELDS.validationCommands),
  );

  useEffect(() => {
    api
      .getSystemSettings()
      .then((response) => {
        const defaults = response.settings.projectDefaults;
        setProjectDefaults(defaults);
        setInstructionSourcesText(defaults.instructionSources.join("\n"));
        setAllowedPathsText(defaults.allowedPaths.join("\n"));
        setForbiddenPathsText(defaults.forbiddenPaths.join("\n"));
        if (defaults.validationCommands.length > 0) {
          setValidationCommands(defaults.validationCommands);
        }
      })
      .catch(() => {
        // The local constants are a safe fallback when settings are unavailable.
      });
  }, []);

  function updateCommand(
    index: number,
    patch: Partial<ValidationCommand>,
    commandText?: string,
  ) {
    setValidationCommands((current) =>
      current.map((command, commandIndex) => {
        if (commandIndex !== index) return command;
        const next = { ...command, ...patch };
        if (commandText !== undefined) {
          next.command = parseCommandLine(commandText);
        }
        return next;
      }),
    );
  }

  function addCommand() {
    const template = projectDefaults?.newValidationCommand;
    setValidationCommands((current) => [
      ...current,
      {
        id: `${template?.id ?? "check"}-${Date.now()}`,
        label: template?.label ?? "检查命令",
        command: template?.command ?? ["npm", "run", "check"],
        timeoutSec: template?.timeoutSec ?? 300,
      },
    ]);
  }

  function removeCommand(index: number) {
    setValidationCommands((current) =>
      current.filter((_, commandIndex) => commandIndex !== index),
    );
  }

  useEffect(() => {
    const jobId = cloneJob?.id;
    if (!jobId) return;

    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) clearInterval(timer);
    };

    const tick = async () => {
      try {
        const { job } = await api.getRemoteCloneJob(jobId);
        if (disposed) return;
        setCloneJob(job);
        if (job.status === "succeeded") {
          stop();
          navigate("/");
        } else if (job.status === "failed") {
          stop();
          setError(job.error ?? "克隆失败");
        }
      } catch (err) {
        if (!disposed) {
          stop();
          setError((err as Error).message);
        }
      }
    };

    void tick();
    timer = setInterval(tick, 700);

    return () => {
      disposed = true;
      stop();
    };
  }, [cloneJob?.id, navigate]);

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
    if (source === "local" && repoError) {
      setError(repoError);
      return;
    }
    if (source === "remote" && !remoteUrl.trim()) {
      setError("请填写远程仓库地址。");
      return;
    }
    if (validationCommands.length === 0) {
      setError("至少需要一条验证命令。");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const instructionSources = lines(instructionSourcesText);
    const allowedPaths = lines(allowedPathsText);
    const forbiddenPaths = lines(forbiddenPathsText);
    try {
      if (source === "remote") {
        const result = await api.createProjectFromRemote({
          name: projectName.trim() || undefined,
          remoteUrl: remoteUrl.trim(),
          username: username.trim() || undefined,
          passwordOrToken: passwordOrToken || undefined,
          defaultBranch: defaultBranch.trim() || undefined,
          instructionSources,
          validationCommands,
          allowedPaths,
          forbiddenPaths,
        });
        setCloneJob(result.job);
      } else {
        await api.createProject({
          name: projectName.trim(),
          repoPath,
          instructionSources,
          validationCommands,
          allowedPaths,
          forbiddenPaths,
        });
        navigate("/");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageBackLink to="/" label="返回项目列表" />
      <PageHeader kicker="项目" title="添加项目" />
      <form className="form" onSubmit={submit}>
        <div className="card form-card">
          <div className="form-section">
            <div className="form-section-heading">
              <h2>1. 项目信息</h2>
              <span className="field-hint">
                {source === "local"
                  ? "选择要修复的本地 Git 仓库"
                  : "填写远程仓库地址，代码会克隆到本地"}
              </span>
            </div>
            <div className="field">
              <div className="radio-row">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="source"
                    checked={source === "local"}
                    onChange={() => {
                      setSource("local");
                      setError("");
                      setRepoError("");
                    }}
                  />
                  本地目录
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="source"
                    checked={source === "remote"}
                    onChange={() => {
                      setSource("remote");
                      setError("");
                    }}
                  />
                  远程仓库（GitHub / GitLab）
                </label>
              </div>
            </div>
            <label className="field">
              名称{" "}
              {source === "local" ? (
                <span className="required-mark">必填</span>
              ) : null}
              <input
                name="name"
                required={source === "local"}
                aria-label="名称"
                placeholder={
                  source === "local" ? "例如：web-service" : "留空则使用仓库名"
                }
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setError("");
                }}
              />
            </label>
            {source === "local" ? (
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
                  <button
                    type="button"
                    className="btn"
                    onClick={pickPath}
                    disabled={picking}
                  >
                    {picking ? "选择中..." : "选择目录"}
                  </button>
                </div>
                {repoError ? (
                  <span className="field-error">{repoError}</span>
                ) : null}
              </div>
            ) : (
              <>
                <label className="field">
                  仓库地址 <span className="required-mark">必填</span>
                  <input
                    name="remoteUrl"
                    required
                    aria-label="仓库地址"
                    placeholder="https://github.com/owner/repo"
                    value={remoteUrl}
                    onChange={(event) => {
                      setRemoteUrl(event.target.value);
                      setError("");
                    }}
                  />
                  <span className="field-hint">
                    仅支持 github.com / gitlab.com 的 HTTPS 地址
                  </span>
                </label>
                <label className="field">
                  用户名（私有仓库）
                  <input
                    name="username"
                    aria-label="用户名"
                    placeholder="私有仓库的用户名，公开仓库留空"
                    value={username}
                    autoComplete="off"
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </label>
                <label className="field">
                  密码 / 令牌（私有仓库）
                  <input
                    name="passwordOrToken"
                    type="password"
                    aria-label="密码或令牌"
                    placeholder="GitHub 请填 Personal Access Token"
                    value={passwordOrToken}
                    autoComplete="new-password"
                    onChange={(event) => setPasswordOrToken(event.target.value)}
                  />
                  <span className="field-hint">
                    GitHub 私有仓库已不支持账号密码，请使用 Personal Access Token
                  </span>
                </label>
                <label className="field">
                  分支（可选）
                  <input
                    name="defaultBranch"
                    aria-label="分支"
                    placeholder="留空使用默认分支"
                    value={defaultBranch}
                    onChange={(event) => setDefaultBranch(event.target.value)}
                  />
                </label>
              </>
            )}
            <label className="field">
              规范来源（每行一个路径）
              <textarea
                name="instructionSources"
                aria-label="规范来源"
                value={instructionSourcesText}
                onChange={(event) => setInstructionSourcesText(event.target.value)}
              />
            </label>
          </div>
          <div className="form-section">
            <div className="form-section-heading">
              <h2>2. 验证命令</h2>
              <span className="field-hint">用于修复后自动检查是否通过</span>
            </div>
          <div className="field">
            <div className="field-heading-row">
              <span>验证命令</span>
              <button type="button" className="btn" onClick={addCommand}>
                添加命令
              </button>
            </div>
            <span className="field-hint">
              每一行是一条命令，例如：npm run typecheck。超时时间单位为秒。
            </span>
            {validationCommands.map((command, index) => (
              <div className="validation-command" key={command.id}>
                <div className="validation-command-row">
                  <input
                    aria-label={`验证命令 ${index + 1} 的标签`}
                    value={command.label}
                    onChange={(event) =>
                      updateCommand(index, { label: event.target.value })
                    }
                    placeholder="命令名称"
                  />
                  <input
                    className="validation-command-command"
                    aria-label={`验证命令 ${index + 1} 内容`}
                    value={validationCommandText(command)}
                    onChange={(event) =>
                      updateCommand(index, {}, event.target.value)
                    }
                    placeholder="npm run test"
                  />
                  <input
                    className="validation-command-timeout"
                    aria-label={`验证命令 ${index + 1} 超时秒数`}
                    type="number"
                    min={1}
                    max={3600}
                    value={command.timeoutSec}
                    onChange={(event) =>
                      updateCommand(index, {
                        timeoutSec: Math.max(
                          1,
                          Math.min(3600, Number(event.target.value) || 1),
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn-danger"
                    aria-label={`删除验证命令 ${index + 1}`}
                    disabled={validationCommands.length === 1}
                    onClick={() => removeCommand(index)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
          </div>
          <div className="form-section">
            <div className="form-section-heading">
              <h2>3. 修改范围</h2>
              <span className="field-hint">
                限制 Codex 可以修改哪些文件。相对路径按仓库根目录解析，例如 src/、node_modules/。
              </span>
            </div>
          <label className="field">
            允许修改路径（每行一个）
            <textarea
              name="allowedPaths"
              aria-label="允许修改路径"
              value={allowedPathsText}
              onChange={(event) => setAllowedPathsText(event.target.value)}
            />
          </label>
          <label className="field">
            禁止修改路径（每行一个）
            <textarea
              name="forbiddenPaths"
              aria-label="禁止修改路径"
              value={forbiddenPathsText}
              onChange={(event) => setForbiddenPathsText(event.target.value)}
            />
          </label>
          </div>
        </div>
        {cloneJob && cloneJob.status === "running" ? (
          <div className="card form-card">
            <div className="clone-progress">
              <div className="clone-progress-head">
                <span>{cloneJob.progress.message}</span>
                {cloneJob.progress.percent !== null ? (
                  <span>{cloneJob.progress.percent}%</span>
                ) : null}
              </div>
              <div className="clone-progress-track">
                <div
                  className="clone-progress-fill"
                  style={{ width: `${cloneJob.progress.percent ?? 0}%` }}
                />
              </div>
              <span className="field-hint">正在克隆远程仓库，请稍候...</span>
            </div>
          </div>
        ) : null}
        <ErrorNotice message={error} />
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={busy || cloneJob?.status === "running"}
          >
            {cloneJob?.status === "running"
              ? "克隆中..."
              : busy
                ? "保存中..."
                : "保存"}
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
  const [project, setProject] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const TASK_PAGE_SIZE = 10;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listProjects(),
      api.listTasks(id),
      api.listTaskAttentionSummaries(id!),
    ])
      .then(([projects, items, next]) => {
        if (!cancelled) {
          setProject(projects.find((item) => item.id === id) ?? null);
          setTasks(items);
          setAttentions(next);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    setPage(1);
  }, [id]);

  const filteredTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const withAttention = (task: BugfixTask) => {
      const attention = attentions[task.id];
      return Boolean(
        attention &&
          (attention.clarification ||
            attention.planApproval?.status === "PENDING" ||
            attention.pendingApprovals > 0 ||
            attention.validation.failed + attention.validation.timeout > 0),
      );
    };

    return tasks.filter((task) => {
      const status = STATUS_META[task.status]?.label ?? task.status;
      const matchesQuery =
        !normalized ||
        [task.title, task.id, status]
        .join(" ")
        .toLowerCase()
        .includes(normalized);

      if (!matchesQuery) return false;
      if (filter === "pending") return withAttention(task);
      if (filter === "active") {
        return [
          "PREPARING_WORKSPACE",
          "ANALYZING",
          "WAITING_FOR_PLAN_APPROVAL",
          "IMPLEMENTING",
          "VALIDATING",
          "WAITING_FOR_ACCEPTANCE",
        ].includes(task.status);
      }
      if (filter === "done") {
        return ["ACCEPTED", "REJECTED", "CANCELLED", "FAILED"].includes(task.status);
      }
      return true;
    });
  }, [attentions, filter, query, tasks]);

  const pendingCount = useMemo(
    () =>
      tasks.filter((task) => {
        const attention = attentions[task.id];
        return Boolean(
          attention &&
            (attention.clarification ||
              attention.planApproval?.status === "PENDING" ||
              attention.pendingApprovals > 0 ||
              attention.validation.failed + attention.validation.timeout > 0),
        );
      }).length,
    [attentions, tasks],
  );

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / TASK_PAGE_SIZE));
  const pageForRender = Math.min(page, totalPages);
  const visibleTasks = filteredTasks.slice(
    (pageForRender - 1) * TASK_PAGE_SIZE,
    pageForRender * TASK_PAGE_SIZE,
  );

  return (
    <section>
      <PageBackLink to="/" label="返回项目列表" />
      <PageHeader
        kicker={project ? project.name : "项目"}
        title="项目任务"
        actions={
          <>
            <Link to={`/projects/${id}/chat`} className="btn">
              自由对话
            </Link>
            <Link to={`/tasks/new?projectId=${id}`} className="btn btn-primary">
              新建 Bugfix 任务
            </Link>
          </>
        }
      />
      {project ? (
        <p className="muted project-path">{project.repoPath}</p>
      ) : null}
      <ErrorNotice message={error} />
      <div className="card card-compact list-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="任务状态筛选">
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => {
              setFilter("all");
              setPage(1);
            }}
          >
            全部
          </button>
          <button
            type="button"
            className={filter === "pending" ? "active" : ""}
            onClick={() => {
              setFilter("pending");
              setPage(1);
            }}
          >
            待处理 {pendingCount > 0 ? `(${pendingCount})` : ""}
          </button>
          <button
            type="button"
            className={filter === "active" ? "active" : ""}
            onClick={() => {
              setFilter("active");
              setPage(1);
            }}
          >
            进行中
          </button>
          <button
            type="button"
            className={filter === "done" ? "active" : ""}
            onClick={() => {
              setFilter("done");
              setPage(1);
            }}
          >
            已结束
          </button>
        </div>
        <label className="field">
          搜索任务
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="按标题、ID 或状态搜索"
          />
        </label>
      </div>
      {loading ? (
        <Loading />
      ) : filteredTasks.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">{query ? "没有匹配的任务。" : "暂无任务。"}</p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="list">
              {visibleTasks.map((task) => (
                <div key={task.id} className="list-item">
                  <div className="list-item-main">
                    <Link to={`/tasks/${task.id}`} className="list-item-title">
                      {task.title}
                    </Link>
                    <span className="list-item-meta" title={task.id}>
                      创建于 {formatDate(task.createdAt)} · {task.id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="list-item-actions">
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
                    <Link to={`/tasks/${task.id}`} className="btn">
                      查看
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <ListPagination
            page={pageForRender}
            totalPages={totalPages}
            total={filteredTasks.length}
            itemLabel="个任务"
            ariaLabel="任务分页"
            disabled={loading}
            onPrevious={() =>
              setPage((current) => Math.max(1, current - 1))
            }
            onNext={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          />
        </>
      )}
    </section>
  );
}

export function NewTaskPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [bugDescription, setBugDescription] = useState("");
  const [observedBehavior, setObservedBehavior] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [reproductionSteps, setReproductionSteps] = useState("");
  const [reproductionCommand, setReproductionCommand] = useState("");
  const [logs, setLogs] = useState("");
  const [relatedFiles, setRelatedFiles] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [constraints, setConstraints] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then((items) => {
        if (cancelled) return;
        setProjects(items);
        setProjectId(
          params.get("projectId") ??
            (items.length === 1 ? items[0].id : ""),
        );
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.createTask({
        projectId,
        title: title.trim() || undefined,
        bugDescription: bugDescription.trim(),
        observedBehavior: observedBehavior.trim(),
        expectedBehavior: expectedBehavior.trim(),
        reproductionSteps: reproductionSteps.trim() || undefined,
        reproductionCommand: reproductionCommand.trim() || undefined,
        logs: logs.trim() || undefined,
        relatedFiles: lines(relatedFiles),
        acceptanceCriteria: lines(acceptanceCriteria),
        constraints: lines(constraints),
      });
      navigate(`/tasks/${result.task.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedProjectId = params.get("projectId") ?? projectId;
  const backTo = selectedProjectId
    ? `/projects/${selectedProjectId}`
    : "/";

  return (
    <section>
      <PageBackLink
        to={backTo}
        label={selectedProjectId ? "返回项目任务" : "返回项目列表"}
      />
      <PageHeader kicker="任务" title="新建 Bugfix 任务" />
      {loading ? (
        <Loading />
      ) : projects.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">还没有可用项目，请先添加一个本地 Git 仓库。</p>
          <div className="actions">
            <Link to="/projects/new" className="btn btn-primary">
              添加项目
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="new-task-intro">描述清楚问题，Codex 会完成定位、修复与验证。</p>
          <form className="form new-task-form" onSubmit={submit}>
            <div className="card form-card">
              <div className="form-section">
                <div className="form-section-heading">
                  <div className="form-section-title">
                    <span className="form-section-tag">描述</span>
                    <h2>这个问题是什么</h2>
                  </div>
                  <span className="field-hint">项目与问题描述是必填项</span>
                </div>
                <div className="ticket-grid">
                  <label className="field">
                    <span className="field-label">
                      标题 <span className="optional-mark">选填</span>
                    </span>
                    <input
                      className="title-input"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="例如：登录后刷新页面会丢失会话"
                    />
                    <span className="field-hint">留空会根据问题描述自动生成</span>
                  </label>
                  <label className="field">
                    <span className="field-label">
                      项目 <span className="required-mark">必填</span>
                    </span>
                    <select
                      name="projectId"
                      required
                      aria-label="项目"
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                    >
                      <option value="" disabled>
                        请选择项目
                      </option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">
                    问题描述 <span className="required-mark">必填</span>
                  </span>
                  <textarea
                    className="description-input"
                    name="bugDescription"
                    required
                    aria-label="问题描述"
                    value={bugDescription}
                    onChange={(event) => setBugDescription(event.target.value)}
                    placeholder="用你自己的话描述：哪里出问题、触发了什么现象。"
                  />
                  <span className="field-hint">一段话概括即可，Codex 会据此展开分析。</span>
                </label>
              </div>

              <div className="advanced-fields">
                <button
                  type="button"
                  className="advanced-toggle"
                  aria-expanded={advancedOpen}
                  aria-controls="advanced-fields-body"
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span className="advanced-toggle-heading">
                    <span className="form-section-tag">更多信息</span>
                    <span className="advanced-toggle-title">高级选项（选填）</span>
                  </span>
                  <span className="advanced-toggle-action">
                    <span className="muted">{advancedOpen ? "收起" : "展开"}</span>
                    <svg
                      className={`icon advanced-chevron${advancedOpen ? " is-open" : ""}`}
                      viewBox="0 0 16 16"
                      width="16"
                      height="16"
                      aria-hidden="true"
                    >
                      <path
                        d="M4 6l4 4 4-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
                {advancedOpen ? (
                  <div id="advanced-fields-body" className="advanced-fields-body">
                    <div className="form-section">
                      <div className="form-section-heading">
                        <div className="form-section-title">
                          <span className="form-section-tag">行为</span>
                          <h2>实际与期望</h2>
                        </div>
                        <span className="field-hint">清晰的目标能显著提高修复质量</span>
                      </div>
                      <div className="two-column-fields behavior-fields">
                        <label className="field field-actual">
                          <span className="field-label">
                            <span className="diff-sign minus" aria-hidden="true">-</span>
                            当前行为
                          </span>
                          <textarea
                            value={observedBehavior}
                            onChange={(event) => setObservedBehavior(event.target.value)}
                            placeholder="实际发生了什么"
                          />
                        </label>
                        <label className="field field-expected">
                          <span className="field-label">
                            <span className="diff-sign plus" aria-hidden="true">+</span>
                            期望行为
                          </span>
                          <textarea
                            value={expectedBehavior}
                            onChange={(event) => setExpectedBehavior(event.target.value)}
                            placeholder="应该发生什么"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="form-section">
                      <div className="form-section-heading">
                        <div className="form-section-title">
                          <span className="form-section-tag">复现</span>
                          <h2>如何触发</h2>
                        </div>
                        <span className="field-hint">尽量补充，可显著提高定位准确率</span>
                      </div>
                      <label className="field">
                        <span className="field-label">复现步骤</span>
                        <textarea
                          value={reproductionSteps}
                          onChange={(event) => setReproductionSteps(event.target.value)}
                          placeholder="按步骤描述如何复现，一行一步"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">复现命令</span>
                        <input
                          className="mono-input"
                          value={reproductionCommand}
                          onChange={(event) => setReproductionCommand(event.target.value)}
                          placeholder="npm run test path/to/case"
                        />
                      </label>
                      <div className="two-column-fields">
                        <label className="field">
                          <span className="field-label">相关文件</span>
                          <textarea
                            className="mono-input"
                            value={relatedFiles}
                            onChange={(event) => setRelatedFiles(event.target.value)}
                            placeholder="每行一个路径，例如 src/app/login.ts"
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">相关日志</span>
                          <textarea
                            className="mono-input"
                            value={logs}
                            onChange={(event) => setLogs(event.target.value)}
                            placeholder="粘贴错误日志、堆栈或关键上下文"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="form-section">
                      <div className="form-section-heading">
                        <div className="form-section-title">
                          <span className="form-section-tag">验收</span>
                          <h2>怎样算修好</h2>
                        </div>
                        <span className="field-hint">决定这次修复怎样算完成</span>
                      </div>
                      <div className="two-column-fields">
                        <label className="field">
                          <span className="field-label">验收条件</span>
                          <textarea
                            value={acceptanceCriteria}
                            onChange={(event) => setAcceptanceCriteria(event.target.value)}
                            placeholder="每行一条，例如：提交后 1 秒内返回结果"
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">约束条件</span>
                          <textarea
                            value={constraints}
                            onChange={(event) => setConstraints(event.target.value)}
                            placeholder="每行一条，例如：不要修改数据库结构"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <ErrorNotice message={error} />
            <div className="form-actions">
              <button className="btn-primary" type="submit" disabled={busy}>
                {busy ? "创建中..." : "创建任务"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

export function TaskDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, loading, error, refresh } = useWorkflowState(id);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [clarificationOpen, setClarificationOpen] = useState(false);
  const [dismissedClarification, setDismissedClarification] = useState<
    number | null
  >(null);
  const { connected, reconnecting, events } = useHarnessEvents(id);
  const { ask, confirmDialog } = useConfirmDialog();

  const latestEvent = events.at(-1);
  useEffect(() => {
    if (latestEvent) {
      void refresh();
    }
  }, [latestEvent, refresh]);

  useEffect(() => {
    const clarification = state?.attention.clarification;
    if (clarification && clarification.requestId !== dismissedClarification) {
      setClarificationOpen(true);
    }
  }, [state?.attention.clarification, dismissedClarification]);

  useEffect(() => {
    if (location.hash === "#clarification" && state?.attention.clarification) {
      setClarificationOpen(true);
    }
  }, [location.hash, state?.attention.clarification]);

  async function run(
    action: () => Promise<unknown>,
    label: string,
    successMessage = `${label} 成功`,
  ) {
    setBusy(label);
    setMessage("");
    setActionError("");
    try {
      await action();
      setMessage(successMessage);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function cancelTask() {
    ask({
      title: "取消任务",
      message: "确定取消该任务吗？正在执行的分析或实施会被中断。",
      confirmLabel: "取消任务",
      danger: true,
      action: () => run(() => api.cancelTask(id!), "取消任务"),
    });
  }

  async function deleteTask() {
    if (!state) {
      return;
    }
    ask({
      title: "删除任务",
      message: "确定删除该任务吗？关联的 worktree 和工作记录也会被清理。",
      confirmLabel: "删除",
      danger: true,
      action: async () => {
        setBusy("删除任务");
        setMessage("");
        setActionError("");
        try {
          await api.deleteTask(id!);
          navigate(`/projects/${state.task.projectId}`);
        } catch (err) {
          setActionError((err as Error).message);
          setBusy("");
        }
      },
    });
  }

  const status = state?.task.status ?? "DRAFT";
  const canAnalyze = status === "DRAFT" || status === "PREPARING_WORKSPACE";
  const hasRunningImplementation = state?.jobs.some(
    (job) =>
      job.status === "running" &&
      (job.kind === "implement" || job.kind === "continue-fix"),
  );
  const canImplement =
    status === "IMPLEMENTING" &&
    !hasRunningImplementation &&
    (state?.attention.pendingApprovals ?? 0) === 0;
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
  const nextAction = state ? nextActionForState(state) : null;
  const currentStep = currentStepForStatus(status as keyof typeof STATUS_META);
  const currentStepLabel =
    WORKFLOW_STEPS.find((step) => step.key === currentStep)?.label ?? "任务详情";
  const workflowHint =
    nextAction?.description ??
    (state ? nextActionForState(state).description : "请查看任务详情。");
  const primaryAction = canAnalyze ? (
    <button
      type="button"
      className="btn btn-primary"
      disabled={Boolean(busy)}
      onClick={() => run(() => api.analyze(id!), "开始修复", "提交成功")}
    >
      {busy === "开始修复" ? "处理中..." : "开始修复"}
    </button>
  ) : canImplement ? (
    <button
      type="button"
      className="btn btn-primary"
      disabled={Boolean(busy)}
      onClick={() =>
        run(
          () => api.implement(id!),
          "开始实施",
          "实施任务已启动，将在后台执行并自动验证。",
        )
      }
    >
      {busy === "开始实施" ? "处理中..." : "开始实施"}
    </button>
  ) : null;

  return (
    <TaskShell
      state={state}
      loading={loading}
      error={error}
      kicker="任务详情"
      title={state?.task.title ?? "任务"}
      primaryAction={primaryAction}
    >
      {confirmDialog}
      <div className="card">
        <div className="meta-grid">
          <div className="meta-cell">
            <span className="meta-label">创建时间</span>
            <span>{formatDate(state?.task.createdAt ?? "")}</span>
          </div>
          <div className="meta-cell">
            <span className="meta-label">更新时间</span>
            <span>{formatDate(state?.task.updatedAt ?? "")}</span>
          </div>
          <div className="meta-cell">
            <span className="meta-label">状态</span>
            <StatusBadge status={status} />
          </div>
          <div className="meta-cell">
            <span className="meta-label">验收条件</span>
            <span>{state?.task.acceptanceCriteria.length ?? 0} 条</span>
          </div>
        </div>
      </div>

      {state?.contract ? (
        <div className="card">
          <div className="card-head">
            <h2>任务说明</h2>
          </div>
          <div className="facts">
            <Fact label="目标" value={state.contract.goal} />
            <Fact
              label="当前行为"
              value={state.contract.observedBehavior || state.task.observedBehavior || "未提供"}
            />
            <Fact
              label="期望行为"
              value={state.contract.expectedBehavior || state.task.expectedBehavior || "未提供"}
            />
            {state.contract.reproduction ? (
              <Fact label="复现信息" value={state.contract.reproduction} />
            ) : null}
            <ListFact
              label="验收条件"
              items={state.contract.acceptanceCriteria}
            />
            <ListFact label="约束条件" items={state.contract.constraints} />
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <h2>工作流</h2>
          <Badge tone="active">{currentStepLabel}</Badge>
        </div>
        <p className="muted workflow-hint">{workflowHint}</p>
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

      {clarificationOpen && state?.attention.clarification ? (
        <ClarificationPanel
          clarification={state.attention.clarification}
          onAnswered={() => {
            setClarificationOpen(false);
            setDismissedClarification(
              state?.attention.clarification?.requestId ?? null,
            );
            navigate(`/tasks/${id}`, { replace: true });
            refresh();
          }}
          onClose={() => {
            setClarificationOpen(false);
            setDismissedClarification(
              state?.attention.clarification?.requestId ?? null,
            );
            navigate(`/tasks/${id}`, { replace: true });
          }}
        />
      ) : null}

      {busy && <Loading>{busy}...</Loading>}
      <ErrorNotice message={actionError || error} />
      <SuccessNotice message={message} />

      <div className="card">
        <div className="card-head">
          <h2>实时事件</h2>
          <div className="card-head-actions">
            <Badge tone={connected ? "success" : reconnecting ? "warning" : "danger"}>
              {connected ? "已连接" : reconnecting ? "重连中..." : "未连接"}
            </Badge>
            <Link to={`/tasks/${id}/logs`} className="btn">
              运行日志
            </Link>
          </div>
        </div>
        {events.length === 0 ? (
          <p className="muted">暂无实时事件。</p>
        ) : (
          <ul className="event-list">
            {events.map((event, index) => (
              <li key={index} className="event-item">
                <span className="event-time">{formatDate(event.emittedAt)}</span>
                <span className="event-type">{eventSummary(event)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TaskShell>
  );
}

export function PlanPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, loading, error, refresh } = useWorkflowState(id);
  const plan = state?.planApproval ?? null;
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const [question, setQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const { ask, confirmDialog } = useConfirmDialog();

  async function approveOnly() {
    setBusy("仅批准");
    setMessage("");
    setActionError("");
    try {
      await api.approvePlan(id!, comment);
      setMessage("已批准计划，下一步可以开始实施。");
      await refresh();
      navigate(`/tasks/${id}`);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function approveAndImplement() {
    setBusy("批准并实施");
    setMessage("");
    setActionError("");
    try {
      await api.approvePlan(id!, comment);
      setMessage("计划已批准，正在开始实施。");
      await api.implement(id!);
      setMessage("实施任务已启动，将在后台执行并自动验证。");
      await refresh();
      navigate(`/tasks/${id}/diff`);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function rejectAndReanalyze() {
    setBusy("退回并重新分析");
    setMessage("");
    setActionError("");
    try {
      await api.rejectPlan(id!, comment);
      setMessage("计划已退回，正在重新分析。");
      await api.analyze(id!);
      await refresh();
      navigate(`/tasks/${id}`);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function askQuestion() {
    setAsking(true);
    setMessage("");
    setActionError("");
    setAiAnswer("");
    try {
      const result = await api.askPlanQuestion(id!, question);
      setAiAnswer(result.answer);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  const canDecide = plan?.status === "PENDING" && !busy;
  const planContent = (plan?.content ?? {}) as Record<string, unknown>;

  return (
    <TaskShell
      state={state}
      loading={loading}
      error={error}
      kicker="审查"
      title="修复计划"
    >
      {confirmDialog}
      <ErrorNotice message={actionError} />
      <SuccessNotice message={message} />
      {!plan ? (
        <div className="card empty-state">
          <p className="muted">当前没有待确认的修复计划。</p>
          <div className="actions">
            <Link to={`/tasks/${id}`} className="btn btn-primary">
              返回任务详情
            </Link>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <h2>修复计划摘要</h2>
            <Badge
              tone={
                plan.status === "APPROVED"
                  ? "success"
                  : plan.status === "REJECTED"
                    ? "danger"
                    : "warning"
              }
            >
              {plan.status === "APPROVED"
                ? "已批准"
                : plan.status === "REJECTED"
                  ? "已退回"
                  : "待确认"}
            </Badge>
          </div>
          <p className="plan-summary">
            {String(planContent.problemSummary ?? "问题摘要")}
          </p>
          <div className="plan-highlights">
            <div>
              <span>它认为问题在哪里</span>
              <strong>{String(planContent.rootCauseHypothesis ?? "未提供")}</strong>
            </div>
            <div>
              <span>准备怎么改</span>
              <strong>{String(planContent.fixStrategy ?? "未提供")}</strong>
            </div>
          </div>
          <div className="facts">
            <Fact
              label="为什么这样判断"
              value={(planContent.evidence as string[] | undefined)?.join("；") || "未提供"}
            />
            <Fact
              label="可能影响哪些文件"
              value={(planContent.proposedFiles as string[] | undefined)?.join("、") || "未提供"}
            />
            <Fact
              label="需要注意"
              value={(planContent.risks as string[] | undefined)?.join("；") || "无"}
            />
            <Fact
              label="还没完全确定"
              value={(planContent.openQuestions as string[] | undefined)?.join("；") || "无"}
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
        {aiAnswer ? <div className="ai-answer">{aiAnswer}</div> : null}
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
        <div className="actions sticky-actions">
          <button
            className="btn-primary"
            disabled={!canDecide}
            onClick={() =>
              ask({
                title: "批准并实施",
                message: "确定批准该计划，并立即让 Codex 开始实施吗？",
                confirmLabel: "批准并实施",
                action: approveAndImplement,
              })
            }
          >
            {busy === "批准并实施" ? "处理中..." : "批准并实施"}
          </button>
          <button
            type="button"
            disabled={!canDecide}
            onClick={() =>
              ask({
                title: "仅批准计划",
                message: "确定只批准计划，稍后再手动开始实施吗？",
                confirmLabel: "仅批准",
                action: approveOnly,
              })
            }
          >
            {busy === "仅批准" ? "处理中..." : "仅批准"}
          </button>
          <button
            className="btn-danger"
            disabled={!canDecide}
            onClick={() => {
              ask({
                title: "退回修复计划",
                message: "确定退回并重新分析吗？Codex 会基于退回意见重新生成计划。",
                confirmLabel: "退回",
                danger: true,
                action: rejectAndReanalyze,
              });
            }}
          >
            {busy === "退回并重新分析" ? "处理中..." : "退回并重新分析"}
          </button>
        </div>
      </div>
    </TaskShell>
  );
}

export function ApprovalsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, loading: workflowLoading, error: workflowError, refresh } =
    useWorkflowState(id);
  const [items, setItems] = useState<ApprovalRequestItem[]>([]);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [showDetails, setShowDetails] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<{
    id: string;
    decision: "accept" | "decline";
  } | null>(null);
  const [batchBusy, setBatchBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const { ask, confirmDialog } = useConfirmDialog();

  async function load() {
    setLoading(true);
    setActionError("");
    try {
      setItems(await api.listApprovals(id!));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [id]);

  async function decide(
    item: ApprovalRequestItem,
    decision: "accept" | "decline",
    label: string,
  ) {
    if (decision === "decline") {
      ask({
        title: "拒绝操作",
        message: "确定拒绝该操作吗？这可能会中断当前修复流程。",
        confirmLabel: "拒绝",
        danger: true,
        action: () => runDecision(item, decision, label),
      });
      return;
    }
    await runDecision(item, decision, label);
  }

  async function runDecision(
    item: ApprovalRequestItem,
    decision: "accept" | "decline",
    label: string,
  ) {
    setBusyItem({ id: String(item.id), decision });
    setActionError("");
    setMessage("");
    try {
      await api.decideApproval(id!, String(item.id), decision);
      setMessage(`${label}成功`);
      await load();
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyItem(null);
    }
  }

  const pendingItems = useMemo(
    () => items.filter((item) => !item.decision),
    [items],
  );

  async function runBatch(decision: "accept" | "decline", label: string) {
    if (pendingItems.length === 0) return;
    setBatchBusy(decision);
    setActionError("");
    setMessage("");
    try {
      await api.decideApprovals(
        id!,
        pendingItems.map((item) => item.id),
        decision,
      );
      setMessage(`${label}成功`);
      await load();
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBatchBusy("");
    }
  }

  return (
    <TaskShell
      state={state}
      loading={workflowLoading}
      error={workflowError}
      kicker="审查"
      title="操作审批"
    >
      {confirmDialog}
      <ErrorNotice message={actionError} />
      <SuccessNotice message={message} />
      {loading ? (
        <Loading />
      ) : pendingItems.length > 0 ? (
        <div className="card">
          <div className="card-head">
            <h2>待处理 {pendingItems.length} 项</h2>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn-primary"
              disabled={Boolean(batchBusy) || Boolean(busyItem)}
              onClick={() => runBatch("accept", "全部允许")}
            >
              {batchBusy === "accept" ? "处理中..." : "全部允许"}
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={Boolean(batchBusy) || Boolean(busyItem)}
              onClick={() => {
                ask({
                  title: "全部拒绝",
                  message: `确定拒绝当前所有 ${pendingItems.length} 个待处理操作吗？`,
                  confirmLabel: "全部拒绝",
                  danger: true,
                  action: () => runBatch("decline", "全部拒绝"),
                });
              }}
            >
              {batchBusy === "decline" ? "处理中..." : "全部拒绝"}
            </button>
          </div>
        </div>
      ) : null}
      {!loading && items.length === 0 ? (
        <div className="card empty-state">
          <p className="muted">暂无审批请求</p>
          <div className="actions">
            <Link to={`/tasks/${id}`} className="btn btn-primary">
              返回任务详情
            </Link>
            <Link to={`/tasks/${id}/diff`} className="btn">
              查看变更与检查
            </Link>
          </div>
        </div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="card">
            <div className="card-head">
              <div className="card-title-group">
                <strong>{approvalSummary(item as unknown as Record<string, unknown>)}</strong>
                <Badge tone={riskTone(item.riskLevel)}>
                  {approvalRiskLabel(item.riskLevel)}
                </Badge>
              </div>
              <Badge tone={item.decision ? "neutral" : "warning"}>
                {item.decision ?? "待处理"}
              </Badge>
            </div>
            <p className="muted">
              {item.decision
                ? "该操作已完成审批。"
                : "批准表示允许 AI 执行；拒绝会阻止该操作。"}
            </p>
            <div className="approval-meta">
              <span>发起时间：{formatDate(item.createdAt)}</span>
              {item.decidedAt ? (
                <span>处理时间：{formatDate(item.decidedAt)}</span>
              ) : null}
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setShowDetails((current) => (current === item.id ? null : item.id))
                }
              >
                {showDetails === item.id ? "收起技术详情" : "查看技术详情"}
              </button>
            </div>
            {showDetails === item.id ? (
              <div className="facts">
                {approvalDetails(item as unknown as Record<string, unknown>).map((detail) => (
                  <Fact key={detail.label} label={detail.label} value={detail.value} />
                ))}
              </div>
            ) : null}
            {!item.decision && (
              <div className="actions">
                <button
                  className="btn-primary"
                  disabled={Boolean(batchBusy) || Boolean(busyItem)}
                  onClick={() => decide(item, "accept", "允许")}
                >
                  {busyItem?.id === item.id && busyItem.decision === "accept"
                    ? "处理中..."
                    : "允许"}
                </button>
                <button
                  className="btn-danger"
                  disabled={Boolean(batchBusy) || Boolean(busyItem)}
                  onClick={() => decide(item, "decline", "拒绝")}
                >
                  {busyItem?.id === item.id && busyItem.decision === "decline"
                    ? "处理中..."
                    : "拒绝"}
                </button>
              </div>
            )}
          </div>
        ))
      )}
      <div className="actions">
        <Link to={`/tasks/${id}`} className="btn">
          返回任务详情
        </Link>
        <Link to={`/tasks/${id}/diff`} className="btn btn-primary">
          查看变更与检查
        </Link>
      </div>
    </TaskShell>
  );
}

function DiffViewer({ diff }: { diff: DiffResult }) {
  const sections = useMemo(
    () => splitUnifiedDiffByFile(diff.unifiedDiff),
    [diff.unifiedDiff],
  );
  // Selection is a file from `diff.files` (never a section path), so a file
  // that has no matching diff section still stays highlighted and shows a
  // clear message instead of silently jumping away.
  const [selected, setSelected] = useState<string | null>(
    () => diff.files[0]?.path ?? null,
  );

  useEffect(() => {
    if (diff.files.length === 0) {
      if (selected !== null) {
        setSelected(null);
      }
      return;
    }

    const stillValid =
      selected !== null &&
      diff.files.some((file) => file.path === selected);
    if (!stillValid) {
      setSelected(diff.files[0].path);
    }
  }, [diff.files, selected]);

  const current =
    sections.find((section) => section.path === selected) ??
    (sections.length === 1 && sections[0].path === "unified diff"
      ? sections[0]
      : null);
  const noDiff = diff.files.length === 0;

  return (
    <div className="diff-layout">
      <div className="diff-file-tree" role="navigation" aria-label="改动文件">
        {diff.files.length === 0 ? (
          <p className="muted">无文件改动</p>
        ) : (
          <ul className="diff-file-list">
            {diff.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={`diff-file-item${selected === file.path ? " active" : ""}`}
                  aria-current={selected === file.path ? "true" : undefined}
                  onClick={() => setSelected(file.path)}
                >
                  <Badge tone={fileTone(file.status)}>
                    {fileStatusLabel(file.status)}
                  </Badge>
                  <span className="mono">{file.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="field diff-file-select">
        选择文件
        <select
          value={selected ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {diff.files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
      </label>

      <div className="diff-pane">
        {current ? (
          <>
            <div className="card-head diff-pane-head">
              <h3>{current.path === "unified diff" ? "代码差异" : current.path}</h3>
              <Badge tone="neutral">{diff.files.length} 个文件</Badge>
            </div>
            <DiffBlock value={current.lines.join("\n")} />
          </>
        ) : (
          <p className="muted">
            {noDiff
              ? "暂无代码差异"
              : "该文件暂无代码差异内容（可能改动已暂存，未包含在本次差异中）。"}
          </p>
        )}
      </div>
    </div>
  );
}

export function DiffPage() {
  const { id } = useParams();
  const location = useLocation();
  const { state, loading, error, refresh } = useWorkflowState(id);
  const diff = state?.diff ?? null;
  const validations = state?.validations ?? [];
  const [openOutput, setOpenOutput] = useState<string | null>(null);
  const [validateBusy, setValidateBusy] = useState(false);
  const [continueBusy, setContinueBusy] = useState(false);
  const [continueMessage, setContinueMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const validationActionRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || location.hash !== "#validation-action") {
        return;
      }
      requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [location.hash],
  );

  const latestValidations = useMemo(
    () => latestValidationOutcomes(validations),
    [validations],
  );

  async function validate() {
    setValidateBusy(true);
    setContinueMessage("");
    setActionError("");
    try {
      await api.runValidations(id!);
      setContinueMessage("检查已运行。");
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setValidateBusy(false);
    }
  }

  async function continueFix() {
    setContinueBusy(true);
    setContinueMessage("");
    setActionError("");
    try {
      await api.continueFix(id!);
      setContinueMessage("已根据失败结果继续修复，验证将自动运行。");
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setContinueBusy(false);
    }
  }

  return (
    <TaskShell
      state={state}
      loading={loading}
      error={error}
      kicker="检查"
      title="变更与检查"
      actions={
        <button
          type="button"
          className="btn"
          onClick={validate}
          disabled={validateBusy}
        >
          {validateBusy ? "检查运行中..." : "运行检查"}
        </button>
      }
    >
      <ErrorNotice message={actionError} />
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
        </div>
      )}

      <p className="muted validation-note">
        实施完成后会自动运行检查。上方“运行检查”仅用于失败修复后手动复跑。
      </p>
      {latestValidations.length > 0 && (
        <div className="stack">
          {latestValidations.map((item) => (
            <div key={item.command.id} className="card card-compact">
              <div className="card-head">
                <div className="card-title-group">
                  <strong>{item.command.label}</strong>
                </div>
                <Badge tone={validationTone(item.status)}>
                  {validationStatusLabel(item.status)}
                </Badge>
              </div>
              <p className="muted validation-command-line">
                {validationCommandText(item.command)}
              </p>
              <p className="muted validation-time">
                开始于 {formatDate(item.startedAt)} · 完成于{" "}
                {formatDate(item.finishedAt)}
              </p>
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

      {latestValidations.some(
        (item) => item.status === "failed" || item.status === "timeout",
      ) ? (
        <div
          className="card"
          id="validation-action"
          ref={validationActionRef}
        >
          <div className="card-head">
            <h2>检查未通过</h2>
          </div>
          <p className="muted">
            失败原因见上方各项检查输出。点击下方按钮，Codex 会带着这些失败输出继续修改，并在完成后自动重新验证。
          </p>
          <div className="actions">
            {state?.task.status === "VALIDATING" ? (
              <button
                type="button"
                className="btn-primary"
                disabled={continueBusy}
                onClick={continueFix}
              >
                {continueBusy ? "正在继续修复..." : "根据失败结果继续修复"}
              </button>
            ) : state?.task.status === "IMPLEMENTING" ? (
              <p className="muted">正在继续修复，验证完成后会自动更新结果。</p>
            ) : (
              <p className="muted">任务已受阻，请人工检查失败输出后处理。</p>
            )}
            <Link to={`/tasks/${id}`} className="btn">
              返回任务详情处理
            </Link>
          </div>
        </div>
      ) : null}

      {latestValidations.every((item) => item.status === "passed") &&
      latestValidations.length > 0 ? (
        <div className="card next-step-card">
          <div className="card-head">
            <h2>检查全部通过</h2>
          </div>
          <p className="muted">接下来可以生成验收报告并做最终决定。</p>
          <div className="actions">
            <Link to={`/tasks/${id}/report`} className="btn btn-primary">
              生成验收报告
            </Link>
          </div>
        </div>
      ) : null}

      {diff && (
        <div className="card">
          <div className="card-head">
            <h2>代码差异</h2>
          </div>
          <DiffViewer diff={diff} />
        </div>
      )}
    </TaskShell>
  );
}

export function ReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, loading, error, refresh } = useWorkflowState(id);
  const report = state?.report ?? null;
  const [comment, setComment] = useState("");
  const [buildBusy, setBuildBusy] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [finalDecision, setFinalDecision] = useState("");
  const [actionError, setActionError] = useState("");
  const { ask, confirmDialog } = useConfirmDialog();

  async function build() {
    setBuildBusy(true);
    setActionError("");
    try {
      await api.buildReport(id!);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBuildBusy(false);
    }
  }

  async function decide(
    action: () => Promise<unknown>,
    label: string,
    navigateAfter: boolean,
  ) {
    setDecisionBusy(label);
    setActionError("");
    setDecisionMessage("");
    try {
      await action();
      setDecisionMessage(
        label === "通过"
          ? "已标记为通过。"
          : label === "需要再改并继续实施"
            ? "已退回修改，并已触发 Codex 继续实施。"
            : "已标记为不采用。",
      );
      setFinalDecision(label);
      await refresh();
      if (navigateAfter) {
        navigate(`/tasks/${id}`);
      }
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setDecisionBusy("");
    }
  }

  async function reworkAndImplement() {
    setDecisionBusy("需要再改并继续实施");
    setActionError("");
    setDecisionMessage("");
    try {
      await api.returnTask(id!, comment);
      setDecisionMessage("已退回修改，正在继续实施。");
      await api.implement(id!);
      setDecisionMessage("已继续实施，自动验证将在后台运行。可稍后查看变更与检查。");
      await refresh();
      setFinalDecision("需要再改并继续实施");
      navigate(`/tasks/${id}/diff`);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setDecisionBusy("");
    }
  }

  return (
    <TaskShell
      state={state}
      loading={loading}
      error={error}
      kicker="交付"
      title="验收报告"
      actions={
        <button
          type="button"
          className="btn-primary"
          onClick={build}
          disabled={buildBusy}
        >
          {buildBusy ? "生成中..." : "生成验收报告"}
        </button>
      }
    >
      {confirmDialog}
      <ErrorNotice message={actionError} />
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
                    ? "请逐项人工确认下方验收条件"
                    : "未提供验收条件，请按实际使用结果判断"
                }
              />
            </div>
          </div>

          {report.acceptanceChecklist.length > 0 ? (
              <div className="card">
                <div className="card-head">
                  <h2>验收条件（请逐项人工确认）</h2>
                </div>
                <ul className="checklist">
                  {report.acceptanceChecklist.map((item) => (
                    <li key={item.criterion} className="check-item">
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
                <div className="actions">
                  <Link to={`/tasks/${id}/diff`} className="btn">
                    查看完整代码差异
                  </Link>
                </div>
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
          <p className="muted">
            尚未生成验收报告，点击上方“生成验收报告”开始。
          </p>
          <div className="actions">
            <Link to={`/tasks/${id}/diff`} className="btn">
              查看变更与检查
            </Link>
          </div>
        </div>
      )}

      <div className="card decision-card">
        <div className="card-head">
          <h2>你的决定</h2>
        </div>
        <p className="muted">
          请先查看上方报告，再决定结果是否可用。不确定时可以选择继续修改。
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
        <div className="actions sticky-actions">
          <button
            className="btn-primary"
            disabled={!report || Boolean(decisionBusy) || Boolean(finalDecision)}
            onClick={() => decide(() => api.acceptTask(id!), "通过", true)}
          >
            {decisionBusy === "通过" ? "处理中..." : "通过"}
          </button>
          <button
            disabled={!report || Boolean(decisionBusy) || Boolean(finalDecision)}
            onClick={reworkAndImplement}
          >
            {decisionBusy === "需要再改并继续实施"
              ? "处理中..."
              : "需要再改并继续实施"}
          </button>
          <button
            className="btn-danger"
            disabled={!report || Boolean(decisionBusy) || Boolean(finalDecision)}
            onClick={() => {
              ask({
                title: "不采用修复结果",
                message: "确定不采用这个修复结果吗？该任务会被标记为不采用。",
                confirmLabel: "不采用",
                danger: true,
                action: () => decide(() => api.rejectTask(id!, comment), "不采用", true),
              });
            }}
          >
            {decisionBusy === "不采用" ? "处理中..." : "不采用"}
          </button>
        </div>
      </div>
    </TaskShell>
  );
}

export function SettingsPage() {
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showRawDisk, setShowRawDisk] = useState(false);

  useEffect(() => {
    api
      .diagnostics()
      .then(setDiagnostics)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    api
      .getPromptTemplates()
      .then((templates) => {
        setPromptTemplates(templates);
        setDrafts(
          Object.fromEntries(
            templates.map((item) => [item.key, item.template]),
          ),
        );
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  function updateDraft(key: string, value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  }

  async function saveTemplates() {
    if (promptTemplates.length === 0) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const templates = Object.fromEntries(
        promptTemplates.map((item) => [item.key, drafts[item.key] ?? item.template]),
      ) as Partial<Record<PromptTemplateKey, string>>;
      const saved = await api.savePromptTemplates(templates);
      setPromptTemplates(saved);
      setDrafts(
        Object.fromEntries(saved.map((item) => [item.key, item.template])),
      );
      setMessage("提示词已保存。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetTemplates(key?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.resetPromptTemplates(key as PromptTemplateKey | undefined);
      setPromptTemplates(saved);
      setDrafts(
        Object.fromEntries(saved.map((item) => [item.key, item.template])),
      );
      setMessage(key ? "该提示词已恢复默认值。" : "所有提示词已恢复默认值。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader kicker="系统" title="系统设置" />
      <ErrorNotice message={error} />
      {message ? <div className="notice notice-success">{message}</div> : null}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>提示词模板</h2>
            <p className="muted field-hint">
              管理分析、实施和计划追问阶段发送给 Codex 的提示词。变量会由系统自动替换。
            </p>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busy || promptTemplates.length === 0}
              onClick={() => resetTemplates()}
            >
              全部恢复默认
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || promptTemplates.length === 0}
              onClick={saveTemplates}
            >
              {busy ? "保存中..." : "保存提示词"}
            </button>
          </div>
        </div>

        {promptTemplates.length > 0 ? (
          <div className="stack">
            {promptTemplates.map((item) => {
              const customized = item.template !== item.defaultTemplate;
              return (
                <div className="prompt-template" key={item.key}>
                  <div className="prompt-template-head">
                    <div>
                      <div className="card-title-group">
                        <h3>{item.label}</h3>
                        <Badge tone={customized ? "active" : "neutral"}>
                          {customized ? "已自定义" : "默认"}
                        </Badge>
                      </div>
                      <p className="muted field-hint">{item.description}</p>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !customized}
                      onClick={() => resetTemplates(item.key)}
                    >
                      恢复默认
                    </button>
                  </div>
                  <label className="field">
                    模板内容
                    <textarea
                      className="prompt-editor"
                      aria-label={`${item.label}提示词`}
                      maxLength={MAX_PROMPT_TEMPLATE_LENGTH}
                      value={drafts[item.key] ?? item.template}
                      onChange={(event) =>
                        updateDraft(item.key, event.target.value)
                      }
                    />
                  </label>
                  <div className="field-hint">
                    可用变量：
                    {item.placeholders.length > 0 ? (
                      item.placeholders.map((placeholder) => (
                        <code className="mono" key={placeholder}>
                          {`{{${placeholder}}}`}
                        </code>
                      ))
                    ) : (
                      <span>无</span>
                    )}
                    <span>，最大 {MAX_PROMPT_TEMPLATE_LENGTH} 字符</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Loading />
        )}
      </div>

      {diagnostics ? (
        <>
          <div className="card">
            <div className="card-head">
              <h2>当前运行配置</h2>
              <Badge tone="neutral">只读诊断</Badge>
            </div>
            <div className="facts">
              <Fact label="Codex Runtime" value={String(diagnostics.runtime)} />
              <Fact label="数据目录" value={String(diagnostics.dataHome)} />
            </div>
            <p className="muted field-hint">
              这些运行时配置来自服务端环境变量，请在服务端启动参数中调整。
            </p>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>磁盘状态</h2>
              {diagnostics.disk &&
              (diagnostics.disk as Record<string, unknown>).warn ? (
                <Badge tone="warning">需要关注</Badge>
              ) : (
                <Badge tone="success">正常</Badge>
              )}
            </div>
            <div className="stat-strip">
              <div className="stat">
                <span className="stat-label">总空间</span>
                <span className="stat-value">
                  {formatBytes((diagnostics.disk as Record<string, unknown>)?.totalBytes)}
                </span>
              </div>
              <div className="stat stat-success">
                <span className="stat-label">可用空间</span>
                <span className="stat-value">
                  {formatBytes((diagnostics.disk as Record<string, unknown>)?.freeBytes)}
                </span>
              </div>
              <div className="stat stat-warning">
                <span className="stat-label">已使用</span>
                <span className="stat-value">
                  {formatBytes((diagnostics.disk as Record<string, unknown>)?.usedBytes)}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">使用率</span>
                <span className="stat-value">
                  {(
                    Number(
                      (diagnostics.disk as Record<string, unknown>)?.usedRatio,
                    ) * 100
                  ).toFixed(1)}
                  %
                </span>
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => setShowRawDisk((current) => !current)}
              >
                {showRawDisk ? "收起原始数据" : "查看原始数据"}
              </button>
            </div>
            {showRawDisk ? (
              <pre className="code">
                {JSON.stringify(diagnostics.disk, null, 2)}
              </pre>
            ) : null}
          </div>
        </>
      ) : (
        <Loading />
      )}
    </section>
  );
}
