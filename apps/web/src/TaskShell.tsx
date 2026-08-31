import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { WorkflowState } from "./api.js";
import {
  effectiveStatusForState,
  nextActionForState,
  stepperForState,
} from "./workflow-model.js";
import { TaskRail } from "./TaskRail.js";

function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "active" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function AttentionPanel({ state }: { state: WorkflowState }) {
  const items: Array<{ label: string; href: string }> = [];
  if (state.attention.clarification) {
    items.push({
      label: "Codex 正在等待你补充分析信息",
      href: `/tasks/${state.task.id}#clarification`,
    });
  }
  if (state.attention.planApproval?.status === "PENDING") {
    items.push({ label: "修复计划等待你确认", href: `/tasks/${state.task.id}/plan` });
  }
  if (state.attention.pendingApprovals > 0) {
    items.push({
      label: `${state.attention.pendingApprovals} 个操作等待审批`,
      href: `/tasks/${state.task.id}/approvals`,
    });
  }
  if (
    state.task.status === "VALIDATING" &&
    state.attention.validation.failed + state.attention.validation.timeout > 0
  ) {
    items.push({
      label: "有自动检查未通过",
      href: `/tasks/${state.task.id}/diff#validation-action`,
    });
  }
  if (state.task.status === "WAITING_FOR_ACCEPTANCE") {
    items.push({ label: "修复结果等待你验收", href: `/tasks/${state.task.id}/report` });
  }
  if (items.length === 0) return null;

  return (
    <div className="attention-panel">
      <div className="attention-panel-head">
        <strong>待你处理</strong>
        <span>{items.length} 项</span>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <Link to={item.href}>去处理</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TaskShell({
  state,
  loading,
  error,
  kicker,
  title,
  actions,
  primaryAction,
  children,
}: {
  state: WorkflowState | null;
  loading: boolean;
  error: string;
  kicker: string;
  title: string;
  actions?: ReactNode;
  primaryAction?: ReactNode;
  children: ReactNode;
}) {
  const location = useLocation();
  if (loading && !state) {
    return (
      <section>
        <div className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="muted">加载任务流程中...</span>
        </div>
      </section>
    );
  }

  if (!state) {
    return (
      <section>
        {error ? (
          <div className="notice notice-error">加载失败：{error}</div>
        ) : null}
      </section>
    );
  }

  const stepper = stepperForState(state);
  const statusMeta = effectiveStatusForState(state);
  const nextAction = nextActionForState(state);
  const isTaskDetail = location.pathname === `/tasks/${state.task.id}`;
  const isCurrentActionPage =
    nextAction.key !== "none" && location.pathname === nextAction.href;
  const runningJob = state.jobs.find((job) => job.status === "running");
  const latestFailedJob = state.jobs.find((job) => job.status === "failed");
  const isWorking = stepper.steps.some((step) => step.state === "working");

  return (
    <section>
      <div className="page-context">
        <Link
          to={
            state.project
              ? `/projects/${state.project.id}`
              : "/"
          }
          className="btn back-link"
        >
          返回项目任务
        </Link>
      </div>

      <header className="page-header">
        <div>
          <p className="page-kicker">{kicker}</p>
          <h1>{title}</h1>
        </div>
        <div className="page-actions">
          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          {actions}
        </div>
      </header>

      <div className="task-context-bar">
        {state.project ? (
          <>
            <span className="meta-label">所属项目</span>
            <Link to={`/projects/${state.project.id}`}>{state.project.name}</Link>
            <span className="mono muted">{state.project.repoPath}</span>
          </>
        ) : (
          <span className="muted">项目信息不可用</span>
        )}
      </div>

      <div className="workflow-block">
        <div className="workflow-block-head">
          <span className="workflow-block-eyebrow">任务进度</span>
          <span
            className={`workflow-live workflow-live-${stepper.tone}`}
            role="status"
            aria-live="polite"
          >
            <span className="workflow-live-dot" aria-hidden="true" />
            {stepper.caption}
          </span>
        </div>
        <div
          className={`workflow-stepper${isWorking ? " is-working" : ""}`}
          aria-label="Bugfix 工作流步骤"
          style={{ "--stepper-progress": stepper.progress } as CSSProperties}
        >
          {stepper.steps.map((step, index) => (
            <div
              key={step.key}
              className="workflow-step"
              data-state={step.state}
              aria-current={step.current ? "step" : undefined}
            >
              <div className="workflow-step-dot" aria-hidden="true">
                {step.state === "done"
                  ? "✓"
                  : step.state === "failed"
                    ? "!"
                    : index + 1}
              </div>
              <span className="workflow-step-label">{step.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="task-layout">
        <TaskRail state={state} />
        <div className="task-body">
          <div className="next-action-banner">
            <div>
              <span className="next-action-kicker">当前需要你做</span>
              <h2>{nextAction.label}</h2>
              <p className="muted">{nextAction.description}</p>
            </div>
            {primaryAction ? (
              primaryAction
            ) : isCurrentActionPage ? (
              <span className="next-action-current">当前正在处理</span>
            ) : nextAction.key !== "none" ? (
              <Link to={nextAction.href} className="btn btn-primary">
                {nextAction.label}
              </Link>
            ) : (
              <Link to={`/tasks/${state.task.id}`} className="btn">
                查看任务详情
              </Link>
            )}
          </div>

          {isTaskDetail ? <AttentionPanel state={state} /> : null}

          {runningJob ? (
            <div className="job-progress" role="status">
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>{runningJob.message}</strong>
                <span className="muted">
                  {runningJob.kind === "implement" || runningJob.kind === "continue-fix"
                    ? "Codex 正在工作，完成后会自动刷新状态。"
                    : "后台任务执行中，完成后会自动刷新状态。"}
                </span>
              </div>
            </div>
          ) : null}

          {latestFailedJob ? (
            <div className="notice notice-error" role="alert">
              {latestFailedJob.message}
              {latestFailedJob.error ? `：${latestFailedJob.error}` : ""}
            </div>
          ) : null}

          {error ? <div className="notice notice-error">{error}</div> : null}
          {loading ? (
            <div className="loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <span className="muted">正在同步最新状态...</span>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </section>
  );
}
