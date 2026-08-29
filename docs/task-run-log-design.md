# 任务级运行日志设计

## 目标

让开发人员和用户在任务详情相关的页面上查看 bugfix-harness 执行过程的完整日志，包括：

- 任务状态变化
- 修复计划提交、审批结果
- 工具调用与命令执行
- 文件变更审批
- 验证命令执行结果
- 后台任务开始、成功、失败
- 错误与异常摘要

普通用户默认看到简洁摘要，开发人员可以切换到详细/调试视图查看原始 payload。

## 现有基础与差距

后端已有：

- `agent_events` 持久化 Codex 运行时通知，且已做脱敏。
- `GET /api/tasks/:id/events` 返回原始运行时事件。
- `EventBus` 通过 `/api/ws` 推送部分领域事件。

差距：

- 原始运行时事件没有 `level / source / phase / message` 等结构，前端无法筛选和排序。
- 领域事件大多未持久化，刷新后历史丢失。
- 部分状态变化和验证事件没有发布。
- 前端任务详情只显示 WebSocket 实时领域事件，未展示持久化运行日志。

## 数据模型

在现有 `agent_events` 表上扩展以下字段，不新建重复表：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | integer | 是 | 主键，自动递增 |
| `task_id` | text | 是 | 关联任务 id |
| `seq` | integer | 是 | 任务内单调递增序号，用于分页 |
| `level` | text | 是 | `debug` / `info` / `warn` / `error` |
| `source` | text | 是 | `runtime` / `workflow` / `validation` / `approval` / `server` |
| `phase` | text | 是 | `prepare` / `analyze` / `plan` / `implement` / `validate` / `report` / `lifecycle` |
| `method` | text | 是 | 运行时通知方法名，或领域事件类型 |
| `message` | text | 是 | 人类可读摘要 |
| `payload_json` | text | 是 | 脱敏后的原始详情 |
| `codex_thread_id` | text | 否 | Codex thread id |
| `codex_turn_id` | text | 否 | Codex turn id |
| `codex_item_id` | text | 否 | Codex item id |
| `emitted_at_ms` | integer | 否 | 事件产生时间戳 |
| `created_at` | text | 是 | 日志写入时间 |

### 日志级别

- `debug`：高频/低价值事件，例如 reasoning/textDelta。
- `info`：正常执行步骤。
- `warn`：非致命失败、重试、审批等待。
- `error`：致命失败、工具错误、验证失败。

### 来源与阶段

来源：

- `runtime`：Codex app-server 通知。
- `workflow`：任务状态变化和计划审批。
- `validation`：验证命令执行结果。
- `approval`：操作审批请求和决策。
- `server`：服务端诊断和错误。

阶段：

- `prepare`：创建 worktree
- `analyze`：分析阶段
- `plan`：计划提交、审批
- `implement`：实施阶段
- `validate`：验证阶段
- `report`：验收报告阶段
- `lifecycle`：跨阶段的任务生命周期事件

## 分类规则

### 运行时通知

| 通知方法或片段 | level | source | phase | message 示例 |
| --- | --- | --- | --- | --- |
| `thread/started` | info | runtime | analyze | 启动分析会话 |
| `thread/status/changed` | info | runtime | analyze | 会话状态变更 |
| `turn/started` | info | runtime | analyze | 开始新的 turn |
| `turn/completed` | info | runtime | analyze | turn 完成 |
| `item/started` | info | runtime | analyze | 开始生成条目 |
| `item/completed` | info | runtime | analyze | 条目完成 |
| `item/reasoning/textDelta` | debug | runtime | analyze | 推理增量 |
| `item/agentMessage/delta` | debug | runtime | analyze | 输出增量 |
| `item/commandExecution/requestApproval` | warn | approval | implement | 请求命令审批 |
| `item/fileChange/requestApproval` | warn | approval | implement | 请求文件写入审批 |
| `item/permissions/requestApproval` | warn | approval | implement | 请求权限审批 |
| `item/tool/requestUserInput` | warn | workflow | analyze | 请求用户补充信息 |
| `mcpServer/startupStatus/updated` | debug | runtime | analyze | MCP 启动状态 |
| 其它包含 `error` 的通知 | error | runtime | implement | 运行时错误 |

### 领域事件

| 事件类型 | level | source | phase | message |
| --- | --- | --- | --- | --- |
| `task.created` | info | workflow | lifecycle | 任务已创建 |
| `task.status_changed` | info | workflow | lifecycle | 任务状态更新为 X |
| `clarification.requested` | warn | workflow | analyze | 等待用户补充信息 |
| `clarification.answered` | info | workflow | analyze | 补充信息已提交 |
| `plan.approval_requested` | warn | workflow | plan | 修复计划等待确认 |
| `plan.approved` | info | workflow | plan | 修复计划已批准 |
| `plan.rejected` | warn | workflow | plan | 修复计划已退回 |
| `job.started` | info | workflow | lifecycle | 后台任务开始 |
| `job.completed` | info | workflow | lifecycle | 后台任务完成 |
| `job.failed` | error | workflow | lifecycle | 后台任务失败 |
| `approval.requested` | warn | approval | implement | 操作等待审批 |
| `approval.decided` | info | approval | implement | 操作审批已完成 |
| `validation.completed` | info/error | validation | validate | 验证完成/验证失败 |
| `worktree.ready` | info | workflow | prepare | worktree 已就绪 |

## API 契约

### 获取任务运行日志

`GET /api/tasks/:id/logs`

请求查询参数：

| 参数 | 类型 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `afterSeq` | integer | `0` | `>= 0` | 返回 `seq > afterSeq` 的日志 |
| `limit` | integer | `100` | `1..1000` | 每页最多返回条数 |
| `level` | string | 无 | `debug/info/warn/error` | 按级别过滤 |
| `source` | string | 无 | `runtime/workflow/validation/approval/server` | 按来源过滤 |
| `phase` | string | 无 | `prepare/analyze/plan/implement/validate/report/lifecycle` | 按阶段过滤 |

成功响应：

```json
{
  "items": [
    {
      "id": 1,
      "taskId": "e969d6af-0a98-4614-a886-7682d1289fd6",
      "seq": 1,
      "level": "info",
      "source": "runtime",
      "phase": "analyze",
      "method": "thread/started",
      "message": "启动分析会话",
      "payload": {},
      "codexThreadId": "01a04b1f-d839-79e3-b476-f26e5f8889dd",
      "codexTurnId": null,
      "codexItemId": null,
      "emittedAtMs": 1787966773375,
      "createdAt": "2026-08-29T01:26:13.375Z"
    }
  ],
  "nextAfterSeq": 1
}
```

`nextAfterSeq` 的规则：

- 若返回条目数小于请求 `limit`，则为 `null`，表示已到末尾。
- 否则等于当前页最后一条的 `seq`，客户端用它作为下一页的 `afterSeq`。

错误响应沿用现有约定：

```json
{ "error": "limit must be a positive integer <= 1000" }
```

## 前端页面

路由：`/tasks/:id/logs`

页面元素：

- 任务标题、当前状态、最近错误摘要
- 级别、来源、阶段筛选
- 日志列表，按时间倒序或正序，带自动跟随开关
- 每条日志展示时间、级别、来源、阶段、消息
- 点击展开原始 payload JSON
- 加载更多按钮，基于 `afterSeq`
- 页面顶部提供返回任务详情链接

任务详情页增加“运行日志”入口。

## 验收标准

### 后端

1. 数据库迁移成功后，`agent_events` 包含 `level / source / phase / message` 四个新列。
2. `AgentEventRepository.append` 能写入分类字段，并能按 `level / source / phase / afterSeq / limit` 查询。
3. `GET /api/tasks/:id/logs` 返回 `{ items, nextAfterSeq }`。
4. 非法 `limit`、`afterSeq`、未知过滤值返回 400 和明确错误。
5. 运行时通知会被分类写入运行日志。
6. 任务状态变化、计划审批、验证完成、审批决策等关键领域事件会写入运行日志。
7. 服务端现有测试和新增日志测试全部通过。

### 前端

1. `/tasks/:id/logs` 路由可访问。
2. 页面能从 API 拉取日志并显示筛选后的列表。
3. 点击日志行能展开原始 payload。
4. “加载更多”能使用 `afterSeq` 继续拉取。
5. 任务详情页有“运行日志”入口。
6. 前端 typecheck、测试和 build 通过。

## 实施顺序

1. 数据库迁移与日志分类器。
2. 扩展仓库查询能力。
3. 关键业务服务补充事件发布与日志写入。
4. 新增日志 API 和测试。
5. 前端类型、API、页面和路由。
6. 全量 typecheck/test/build 与接口冒烟验证。
