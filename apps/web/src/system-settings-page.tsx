import { useEffect, useState, type ReactNode } from "react";
import {
  MAX_PROMPT_TEMPLATE_LENGTH,
  type PromptTemplateKey,
  type SystemSettings,
  type ValidationCommand,
} from "@bugfix-harness/shared";
import {
  api,
  type CodexRuntimeInfo,
  type PromptTemplateSetting,
} from "./api.js";

function formatBytes(value: unknown): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function commandText(command: string[]): string {
  return command.join(" ");
}

function parseCommandLine(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="notice notice-error">{message}</div>;
}

function SuccessNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="notice notice-success">{message}</div>;
}

function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">加载中...</span>
    </div>
  );
}

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "active" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function PageHeader({
  kicker,
  title,
}: {
  kicker?: string;
  title: string;
}) {
  return (
    <header className="page-header">
      <div>
        {kicker ? <p className="page-kicker">{kicker}</p> : null}
        <h1>{title}</h1>
      </div>
    </header>
  );
}

function Card({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {description ? <p className="muted field-hint">{description}</p> : null}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step = 1,
  unit,
  allowEmpty = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  step?: number;
  unit?: string;
  allowEmpty?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          if (allowEmpty && raw === "") {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : value);
        }}
      />
      {unit ? <span className="field-hint">{unit}</span> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MultiLineField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="field">
      {label}
      <textarea
        value={value.join("\n")}
        onChange={(event) =>
          onChange(
            event.target.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function ValidationCommandEditor({
  commands,
  onChange,
}: {
  commands: ValidationCommand[];
  onChange: (commands: ValidationCommand[]) => void;
}) {
  function updateCommand(
    index: number,
    patch: Partial<ValidationCommand>,
    commandTextValue?: string,
  ) {
    onChange(
      commands.map((command, commandIndex) => {
        if (commandIndex !== index) return command;
        const next = { ...command, ...patch };
        if (commandTextValue !== undefined) {
          next.command = parseCommandLine(commandTextValue);
        }
        return next;
      }),
    );
  }

  function addCommand() {
    onChange([
      ...commands,
      {
        id: `command-${Date.now()}`,
        label: "检查命令",
        command: ["npm", "run", "check"],
        timeoutSec: 300,
      },
    ]);
  }

  function removeCommand(index: number) {
    onChange(commands.filter((_, commandIndex) => commandIndex !== index));
  }

  return (
    <div className="field">
      <div className="field-heading-row">
        <span>默认验证命令</span>
        <button type="button" className="btn" onClick={addCommand}>
          添加命令
        </button>
      </div>
      {commands.map((command, index) => (
        <div className="validation-command" key={command.id}>
          <div className="validation-command-row">
            <input
              aria-label={`默认验证命令 ${index + 1} 的标签`}
              value={command.label}
              onChange={(event) =>
                updateCommand(index, { label: event.target.value })
              }
              placeholder="命令名称"
            />
            <input
              className="validation-command-command"
              aria-label={`默认验证命令 ${index + 1} 内容`}
              value={commandText(command.command)}
              onChange={(event) =>
                updateCommand(index, {}, event.target.value)
              }
              placeholder="npm run test"
            />
            <input
              className="validation-command-timeout"
              aria-label={`默认验证命令 ${index + 1} 超时秒数`}
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
              aria-label={`删除默认验证命令 ${index + 1}`}
              disabled={commands.length === 1}
              onClick={() => removeCommand(index)}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function cloneSettings(value: SystemSettings): SystemSettings {
  return structuredClone(value);
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [defaults, setDefaults] = useState<SystemSettings | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateSetting[]>([]);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeInfo | null>(null);
  const [manualCodexPath, setManualCodexPath] = useState("");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [showRawDisk, setShowRawDisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getSystemSettings()
      .then((response) => {
        setSettings(response.settings);
        setDefaults(response.defaults);
      })
      .catch((err) => setError((err as Error).message));

    api
      .diagnostics()
      .then(setDiagnostics)
      .catch((err) => setError((err as Error).message));

    api
      .getPromptTemplates()
      .then((templates) => {
        setPromptTemplates(templates);
        setPromptDrafts(
          Object.fromEntries(templates.map((item) => [item.key, item.template])),
        );
      })
      .catch((err) => setError((err as Error).message));

    api
      .getCodexRuntime()
      .then((runtime) => {
        setCodexRuntime(runtime);
        setManualCodexPath(runtime.codexBin ?? "");
      })
      .catch((err) => setRuntimeError((err as Error).message));
  }, []);

  function updateSettings(
    patch: (current: SystemSettings) => SystemSettings,
  ) {
    setSettings((current) => (current ? patch(cloneSettings(current)) : current));
    setMessage("");
    setError("");
  }

  async function saveSystemSettings() {
    if (!settings) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await api.saveSystemSettings(settings);
      setSettings(response.settings);
      setDefaults(response.defaults);
      setMessage("系统设置已保存。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetSystemSettings() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await api.resetSystemSettings();
      setSettings(response.settings);
      setDefaults(response.defaults);
      setMessage("系统设置已恢复默认值。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePromptTemplates() {
    if (promptTemplates.length === 0) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const templates = Object.fromEntries(
        promptTemplates.map((item) => [
          item.key,
          promptDrafts[item.key] ?? item.template,
        ]),
      ) as Partial<Record<PromptTemplateKey, string>>;
      const saved = await api.savePromptTemplates(templates);
      setPromptTemplates(saved);
      setPromptDrafts(
        Object.fromEntries(saved.map((item) => [item.key, item.template])),
      );
      setMessage("提示词已保存。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPromptTemplates(key?: PromptTemplateKey) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.resetPromptTemplates(key);
      setPromptTemplates(saved);
      setPromptDrafts(
        Object.fromEntries(saved.map((item) => [item.key, item.template])),
      );
      setMessage(key ? "该提示词已恢复默认值。" : "所有提示词已恢复默认值。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickCodexPath() {
    setRuntimeBusy(true);
    setRuntimeError("");
    try {
      const result = await api.pickCodexFile();
      if (result.path) {
        setManualCodexPath(result.path);
      }
    } catch (err) {
      setRuntimeError((err as Error).message);
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function saveCodexPath() {
    setRuntimeBusy(true);
    setRuntimeError("");
    try {
      const runtime = await api.saveCodexRuntime(manualCodexPath);
      setCodexRuntime(runtime);
      setManualCodexPath(runtime.codexBin ?? "");
      setMessage("Codex 运行路径已保存。");
    } catch (err) {
      setRuntimeError((err as Error).message);
    } finally {
      setRuntimeBusy(false);
    }
  }

  if (!settings || !defaults) {
    return (
      <section>
        <PageHeader kicker="系统" title="系统设置" />
        <Loading />
      </section>
    );
  }

  const agent = settings.agent;
  const models = settings.models;
  const security = settings.security;
  const projectDefaults = settings.projectDefaults;
  const remote = settings.remote;

  return (
    <section>
      <PageHeader kicker="系统" title="系统设置" />
      <ErrorNotice message={error} />
      <SuccessNotice message={message} />

      <Card
        title="提示词模板"
        description="管理分析、实施和计划追问阶段发送给 Codex 的提示词。"
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={busy || promptTemplates.length === 0}
              onClick={() => resetPromptTemplates()}
            >
              全部恢复默认
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || promptTemplates.length === 0}
              onClick={savePromptTemplates}
            >
              {busy ? "保存中..." : "保存提示词"}
            </button>
          </>
        }
      >
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
                      onClick={() => resetPromptTemplates(item.key)}
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
                      value={promptDrafts[item.key] ?? item.template}
                      onChange={(event) =>
                        setPromptDrafts((current) => ({
                          ...current,
                          [item.key]: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <Loading />
        )}
      </Card>

      <Card
        title="Agent 运行与超时"
        description="控制 Bugfix 任务和自由对话的等待时间。"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={saveSystemSettings}
          >
            {busy ? "保存中..." : "保存本组"}
          </button>
        }
      >
        <div className="settings-grid">
          <NumberField
            label="分析阶段空闲超时"
            unit="ms"
            min={1000}
            value={agent.analysisIdleTimeoutMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                agent: {
                  ...current.agent,
                  analysisIdleTimeoutMs: value ?? 600_000,
                },
              }))
            }
          />
          <NumberField
            label="实施阶段空闲超时"
            unit="ms"
            min={1000}
            value={agent.implementationIdleTimeoutMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                agent: {
                  ...current.agent,
                  implementationIdleTimeoutMs: value ?? 600_000,
                },
              }))
            }
          />
          <NumberField
            label="分析阶段累计最大时长"
            unit="ms，空为不限"
            min={1000}
            allowEmpty
            value={agent.analysisMaxDurationMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                agent: { ...current.agent, analysisMaxDurationMs: value },
              }))
            }
          />
          <NumberField
            label="实施阶段累计最大时长"
            unit="ms，空为不限"
            min={1000}
            allowEmpty
            value={agent.implementationMaxDurationMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                agent: { ...current.agent, implementationMaxDurationMs: value },
              }))
            }
          />
          <NumberField
            label="自由对话空闲超时"
            unit="ms"
            min={1000}
            value={agent.conversationIdleTimeoutMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                agent: {
                  ...current.agent,
                  conversationIdleTimeoutMs: value ?? 600_000,
                },
              }))
            }
          />
          <NumberField
            label="自由对话审批/澄清 TTL"
            unit="ms，空为不限"
            min={1000}
            allowEmpty
            value={agent.approvalTtlMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                agent: { ...current.agent, approvalTtlMs: value },
              }))
            }
          />
        </div>
      </Card>

      <Card
        title="模型与推理强度默认值"
        description="为 Bugfix 任务和自由对话设置默认模型与推理强度。"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={saveSystemSettings}
          >
            {busy ? "保存中..." : "保存本组"}
          </button>
        }
      >
        <div className="settings-grid">
          <TextField
            label="Bugfix 默认模型"
            value={models.bugfixModel ?? ""}
            placeholder="留空由 Codex 选择"
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                models: {
                  ...current.models,
                  bugfixModel: value.trim() || undefined,
                },
              }))
            }
          />
          <TextField
            label="Bugfix 默认推理强度"
            value={models.bugfixReasoningEffort ?? ""}
            placeholder="留空使用默认"
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                models: {
                  ...current.models,
                  bugfixReasoningEffort: value.trim() || undefined,
                },
              }))
            }
          />
          <TextField
            label="自由对话默认模型"
            value={models.conversationModel ?? ""}
            placeholder="留空由 Codex 选择"
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                models: {
                  ...current.models,
                  conversationModel: value.trim() || undefined,
                },
              }))
            }
          />
          <TextField
            label="自由对话默认推理强度"
            value={models.conversationReasoningEffort ?? ""}
            placeholder="留空使用默认"
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                models: {
                  ...current.models,
                  conversationReasoningEffort: value.trim() || undefined,
                },
              }))
            }
          />
        </div>
      </Card>

      <Card
        title="安全默认值"
        description="配置新建对话和 Bugfix 各阶段的默认审批策略。全自动执行会跳过人工批准计划和验收；安全边界仍保持硬编码。默认保持人工审批。"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={saveSystemSettings}
          >
            {busy ? "保存中..." : "保存本组"}
          </button>
        }
      >
        <div className="settings-grid">
          <label className="field">
            Bugfix 执行模式
            <select
              value={security.bugfixAutomationMode}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    bugfixAutomationMode: event.target.value as
                      | "manual"
                      | "auto",
                  },
                }))
              }
            >
              <option value="auto">全自动执行</option>
              <option value="manual">人工审批</option>
            </select>
          </label>
          <label className="field">
            新建对话沙箱模式
            <select
              value={security.conversationDefaults.sandboxMode}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    conversationDefaults: {
                      ...current.security.conversationDefaults,
                      sandboxMode: event.target.value as
                        | "read-only"
                        | "workspace-write"
                        | "danger-full-access",
                    },
                  },
                }))
              }
            >
              <option value="read-only">只读</option>
              <option value="workspace-write">工作区可写</option>
              <option value="danger-full-access">完整访问</option>
            </select>
          </label>
          <label className="field">
            新建对话审批策略
            <select
              value={security.conversationDefaults.approvalPolicy}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    conversationDefaults: {
                      ...current.security.conversationDefaults,
                      approvalPolicy: event.target.value as
                        | "on-request"
                        | "never"
                        | "untrusted"
                        | "granular",
                    },
                  },
                }))
              }
            >
              <option value="on-request">按需审批</option>
              <option value="never">不审批</option>
              <option value="untrusted">不信任模式</option>
              <option value="granular">细粒度</option>
            </select>
          </label>
          <label className="field">
            新建对话审批人
            <select
              value={security.conversationDefaults.approvalsReviewer}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    conversationDefaults: {
                      ...current.security.conversationDefaults,
                      approvalsReviewer: event.target.value as
                        | "user"
                        | "auto_review"
                        | "guardian_subagent",
                    },
                  },
                }))
              }
            >
              <option value="user">用户</option>
              <option value="auto_review">自动审查</option>
              <option value="guardian_subagent">守护子代理</option>
            </select>
          </label>
          <label className="field inline-field">
            <input
              type="checkbox"
              checked={security.conversationDefaults.networkAccess}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    conversationDefaults: {
                      ...current.security.conversationDefaults,
                      networkAccess: event.target.checked,
                    },
                  },
                }))
              }
            />
            新建对话允许网络访问
          </label>
          <label className="field inline-field">
            <input
              type="checkbox"
              checked={security.conversationDefaults.allowGitWrites}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    conversationDefaults: {
                      ...current.security.conversationDefaults,
                      allowGitWrites: event.target.checked,
                    },
                  },
                }))
              }
            />
            新建对话允许 Git 写入
          </label>
          <label className="field">
            Bugfix 分析阶段审批策略
            <select
              value={security.analyzeApprovalPolicy}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    analyzeApprovalPolicy: event.target.value as
                      | "on-request"
                      | "never"
                      | "untrusted"
                      | "granular",
                  },
                }))
              }
            >
              <option value="on-request">按需审批</option>
              <option value="never">不审批</option>
              <option value="untrusted">不信任模式</option>
              <option value="granular">细粒度</option>
            </select>
          </label>
          <label className="field">
            Bugfix 分析阶段审批人
            <select
              value={security.analyzeApprovalsReviewer}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    analyzeApprovalsReviewer: event.target.value as
                      | "user"
                      | "auto_review"
                      | "guardian_subagent",
                  },
                }))
              }
            >
              <option value="user">用户</option>
              <option value="auto_review">自动审查</option>
              <option value="guardian_subagent">守护子代理</option>
            </select>
          </label>
          <label className="field">
            Bugfix 实施阶段审批策略
            <select
              value={security.implementApprovalPolicy}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    implementApprovalPolicy: event.target.value as
                      | "on-request"
                      | "never"
                      | "untrusted"
                      | "granular",
                  },
                }))
              }
            >
              <option value="on-request">按需审批</option>
              <option value="never">不审批</option>
              <option value="untrusted">不信任模式</option>
              <option value="granular">细粒度</option>
            </select>
          </label>
          <label className="field">
            Bugfix 实施阶段审批人
            <select
              value={security.implementApprovalsReviewer}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    implementApprovalsReviewer: event.target.value as
                      | "user"
                      | "auto_review"
                      | "guardian_subagent",
                  },
                }))
              }
            >
              <option value="user">用户</option>
              <option value="auto_review">自动审查</option>
              <option value="guardian_subagent">守护子代理</option>
            </select>
          </label>
        </div>
      </Card>

      <Card
        title="新建项目默认值"
        description="用于新建项目表单的预填内容，不会修改已有项目。"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={saveSystemSettings}
          >
            {busy ? "保存中..." : "保存本组"}
          </button>
        }
      >
        <MultiLineField
          label="默认规范来源"
          value={projectDefaults.instructionSources}
          onChange={(value) =>
            updateSettings((current) => ({
              ...current,
              projectDefaults: {
                ...current.projectDefaults,
                instructionSources: value,
              },
            }))
          }
        />
        <ValidationCommandEditor
          commands={projectDefaults.validationCommands}
          onChange={(value) =>
            updateSettings((current) => ({
              ...current,
              projectDefaults: {
                ...current.projectDefaults,
                validationCommands: value,
              },
            }))
          }
        />
        <div className="field-heading-row">
          <span>新增验证命令默认值</span>
        </div>
        <div className="settings-grid">
          <TextField
            label="命令标签"
            value={projectDefaults.newValidationCommand.label}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                projectDefaults: {
                  ...current.projectDefaults,
                  newValidationCommand: {
                    ...current.projectDefaults.newValidationCommand,
                    label: value,
                  },
                },
              }))
            }
          />
          <TextField
            label="命令内容"
            value={commandText(projectDefaults.newValidationCommand.command)}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                projectDefaults: {
                  ...current.projectDefaults,
                  newValidationCommand: {
                    ...current.projectDefaults.newValidationCommand,
                    command: parseCommandLine(value),
                  },
                },
              }))
            }
          />
          <NumberField
            label="超时秒数"
            min={1}
            value={projectDefaults.newValidationCommand.timeoutSec}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                projectDefaults: {
                  ...current.projectDefaults,
                  newValidationCommand: {
                    ...current.projectDefaults.newValidationCommand,
                    timeoutSec: value ?? 300,
                  },
                },
              }))
            }
          />
        </div>
        <MultiLineField
          label="默认允许修改路径"
          value={projectDefaults.allowedPaths}
          onChange={(value) =>
            updateSettings((current) => ({
              ...current,
              projectDefaults: {
                ...current.projectDefaults,
                allowedPaths: value,
              },
            }))
          }
        />
        <MultiLineField
          label="默认禁止修改路径"
          value={projectDefaults.forbiddenPaths}
          onChange={(value) =>
            updateSettings((current) => ({
              ...current,
              projectDefaults: {
                ...current.projectDefaults,
                forbiddenPaths: value,
              },
            }))
          }
        />
      </Card>

      <Card
        title="远程仓库"
        description="配置远程仓库探测和克隆的超时时间。"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={saveSystemSettings}
          >
            {busy ? "保存中..." : "保存本组"}
          </button>
        }
      >
        <div className="settings-grid">
          <NumberField
            label="远程仓库探测超时"
            unit="ms"
            min={1000}
            value={remote.lsRemoteTimeoutMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                remote: {
                  ...current.remote,
                  lsRemoteTimeoutMs: value ?? 30_000,
                },
              }))
            }
          />
          <NumberField
            label="Git 克隆超时"
            unit="ms"
            min={1000}
            value={remote.cloneTimeoutMs}
            onChange={(value) =>
              updateSettings((current) => ({
                ...current,
                remote: {
                  ...current.remote,
                  cloneTimeoutMs: value ?? 600_000,
                },
              }))
            }
          />
        </div>
      </Card>

      <Card
        title="运行时路径与 Codex 二进制"
        description="自动检测可用的 Codex 运行环境，检测不到时可手动指定 CODEX_BIN。"
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={runtimeBusy}
              onClick={pickCodexPath}
            >
              {runtimeBusy ? "选择中..." : "选择文件"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={runtimeBusy || !manualCodexPath.trim()}
              onClick={saveCodexPath}
            >
              {runtimeBusy ? "检测中..." : "保存路径"}
            </button>
          </>
        }
      >
        {runtimeError ? <div className="notice notice-error">{runtimeError}</div> : null}
        {codexRuntime?.warning ? (
          <div className="notice notice-warning">{codexRuntime.warning}</div>
        ) : null}
        <div className="facts">
          <div className="fact">
            <span className="fact-label">Runtime 命令</span>
            <span className="fact-value">
              {codexRuntime?.runtimeCommand ?? "检测中..."}
            </span>
          </div>
          <div className="fact">
            <span className="fact-label">检测状态</span>
            <span className="fact-value">
              {codexRuntime
                ? codexRuntime.available
                  ? "可用"
                  : "不可用"
                : "检测中..."}
            </span>
          </div>
          <div className="fact">
            <span className="fact-label">Codex 版本</span>
            <span className="fact-value">
              {codexRuntime?.version ?? "—"}
            </span>
          </div>
          <div className="fact">
            <span className="fact-label">CODEX_BIN</span>
            <span className="fact-value">{codexRuntime?.codexBin ?? "—"}</span>
          </div>
          <div className="fact">
            <span className="fact-label">来源</span>
            <span className="fact-value">{codexRuntime?.source ?? "—"}</span>
          </div>
        </div>
        <label className="field">
          手动指定 CODEX_BIN
          <input
            value={manualCodexPath}
            placeholder="/path/to/codex 或 C:\\path\\to\\codex.exe"
            onChange={(event) => setManualCodexPath(event.target.value)}
          />
          <span className="field-hint">
            保存后会校验该文件是否可执行；检测结果会用于后续 Agent 和对话运行。
          </span>
        </label>
      </Card>

      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={resetSystemSettings}
        >
          恢复全部默认
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={saveSystemSettings}
        >
          {busy ? "保存中..." : "保存全部系统设置"}
        </button>
      </div>

      {diagnostics ? (
        <Card title="当前运行配置" description="只读诊断信息。">
          <div className="facts">
            <div className="fact">
              <span className="fact-label">Codex Runtime</span>
              <span className="fact-value">
                {String(diagnostics.runtime ?? "—")}
              </span>
            </div>
            <div className="fact">
              <span className="fact-label">数据目录</span>
              <span className="fact-value">
                {String(diagnostics.dataHome ?? "—")}
              </span>
            </div>
            <div className="fact">
              <span className="fact-label">磁盘状态</span>
              <span className="fact-value">
                {(diagnostics.disk as Record<string, unknown>)?.warn
                  ? "需要关注"
                  : "正常"}
              </span>
            </div>
          </div>
          <div className="stat-strip">
            <div className="stat">
              <span className="stat-label">总空间</span>
              <span className="stat-value">
                {formatBytes(
                  (diagnostics.disk as Record<string, unknown>)?.totalBytes,
                )}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">可用空间</span>
              <span className="stat-value">
                {formatBytes(
                  (diagnostics.disk as Record<string, unknown>)?.freeBytes,
                )}
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
        </Card>
      ) : (
        <Loading />
      )}
    </section>
  );
}
