export type TaskLogLevel = "debug" | "info" | "warn" | "error";
export type TaskLogSource =
  | "runtime"
  | "workflow"
  | "validation"
  | "approval"
  | "server";
export type TaskLogPhase =
  | "prepare"
  | "analyze"
  | "plan"
  | "implement"
  | "validate"
  | "report"
  | "lifecycle";

export interface TaskLogClassification {
  level: TaskLogLevel;
  source: TaskLogSource;
  phase: TaskLogPhase;
  message: string;
}

function readPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function inferRuntimePhase(
  method: string,
  phaseHint?: TaskLogPhase,
): TaskLogPhase {
  if (phaseHint) {
    return phaseHint;
  }
  if (method === "item/tool/requestUserInput") {
    return "analyze";
  }
  if (
    method.includes("commandExecution") ||
    method.includes("fileChange") ||
    method.includes("permissions") ||
    method === "applyPatchApproval" ||
    method === "execCommandApproval"
  ) {
    return "implement";
  }
  if (method.includes("validation")) {
    return "validate";
  }
  return "analyze";
}

function runtimeMessage(
  method: string,
  payload: Record<string, unknown>,
): string {
  const label = String(method);
  if (method === "thread/started") return "启动 Codex 会话";
  if (method === "thread/status/changed") {
    const status = payload.status;
    if (status && typeof status === "object") {
      return `会话状态变更：${String(
        (status as { type?: string }).type ?? "",
      )}`;
    }
    return "会话状态变更";
  }
  if (method === "turn/started") return "开始新的 turn";
  if (method === "turn/completed") return "turn 完成";
  if (method === "item/started") {
    const itemType = String(payload.itemType ?? "");
    return itemType ? `开始生成条目：${itemType}` : "开始生成条目";
  }
  if (method === "item/completed") {
    const itemType = String(payload.itemType ?? "");
    return itemType ? `条目完成：${itemType}` : "条目完成";
  }
  if (method === "item/tool/requestUserInput") {
    return "Codex 请求用户补充信息";
  }
  if (method === "item/commandExecution/requestApproval") {
    return "请求命令执行审批";
  }
  if (method === "item/fileChange/requestApproval") {
    return "请求文件写入审批";
  }
  if (method === "item/permissions/requestApproval") {
    return "请求权限审批";
  }
  if (method === "mcpServer/startupStatus/updated") {
    return `MCP 服务状态：${String(payload.status ?? "")}`;
  }
  return label;
}

export function classifyRuntimeNotification(
  method: string,
  payload: unknown,
  phaseHint?: TaskLogPhase,
): TaskLogClassification {
  const data = readPayload(payload);
  const phase = inferRuntimePhase(method, phaseHint);
  let level: TaskLogLevel = "info";
  let source: TaskLogSource = "runtime";

  if (
    method.includes("textDelta") ||
    method.includes("agentMessage/delta") ||
    method === "mcpServer/startupStatus/updated" ||
    method === "remoteControl/status/changed"
  ) {
    level = "debug";
  }

  if (method.includes("requestApproval")) {
    level = "warn";
    source = "approval";
  }

  if (method === "item/tool/requestUserInput") {
    level = "warn";
    source = "workflow";
  }

  if (
    method.includes("error") ||
    data.error != null ||
    data.failureReason != null
  ) {
    level = "error";
  }

  return {
    level,
    source,
    phase,
    message: runtimeMessage(method, data),
  };
}

function domainPayloadType(payload: unknown): Record<string, unknown> {
  return readPayload(payload);
}

export function classifyHarnessEvent(
  type: string,
  payload: unknown,
): TaskLogClassification {
  const data = domainPayloadType(payload);
  const base = {
    level: "info" as TaskLogLevel,
    source: "workflow" as TaskLogSource,
    phase: "lifecycle" as TaskLogPhase,
    message: type,
  };

  switch (type) {
    case "task.created":
      return { ...base, message: "任务已创建", phase: "lifecycle" };
    case "task.status_changed":
      return {
        ...base,
        message: `任务状态更新为：${String(data.status ?? "")}`,
        phase: "lifecycle",
      };
    case "clarification.requested":
      return { ...base, level: "warn", phase: "analyze", message: "等待用户补充信息" };
    case "clarification.answered":
      return { ...base, phase: "analyze", message: "补充信息已提交" };
    case "plan.approval_requested":
      return { ...base, level: "warn", phase: "plan", message: "修复计划等待确认" };
    case "plan.approved":
      return { ...base, phase: "plan", message: "修复计划已批准" };
    case "plan.rejected":
      return { ...base, level: "warn", phase: "plan", message: "修复计划已退回" };
    case "job.started":
      {
        const job = domainPayloadType(data.job);
        return {
          ...base,
          message: `后台任务开始：${String(job.message ?? job.kind ?? "")}`,
        };
      }
    case "job.completed":
      {
        const job = domainPayloadType(data.job);
        return {
          ...base,
          message: `后台任务完成：${String(job.message ?? job.kind ?? "")}`,
        };
      }
    case "job.failed":
      {
        const job = domainPayloadType(data.job);
        return {
          ...base,
          level: "error",
          message: `后台任务失败：${String(job.message ?? job.kind ?? "")}`,
        };
      }
    case "approval.requested":
      return { ...base, level: "warn", source: "approval", phase: "implement", message: "操作等待审批" };
    case "approval.decided":
      return {
        ...base,
        source: "approval",
        phase: "implement",
        message: `操作审批已完成：${String(data.decision ?? "")}`,
      };
    case "validation.completed":
      return {
        ...base,
        source: "validation",
        phase: "validate",
        level: data.failed || data.timeout ? "error" : "info",
        message: `验证完成：通过 ${String(data.passed ?? 0)}，失败 ${String(
          data.failed ?? 0,
        )}，超时 ${String(data.timeout ?? 0)}`,
      };
    case "worktree.ready":
      return { ...base, phase: "prepare", message: "工作区已就绪" };
    case "project.created":
      return { ...base, message: "项目已创建" };
    case "project.deleted":
      return { ...base, message: "项目已删除" };
    case "task.deleted":
      return { ...base, message: "任务已删除" };
    default:
      return base;
  }
}
