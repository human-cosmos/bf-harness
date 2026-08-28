# 项目自由对话（Arbitrary Codex Chat）技术设计

## 1. 目标

在现有 Bugfix Harness 中新增与 `tasks` 平级的 **项目自由对话** 能力。用户选择一个本地 Git 项目后，可以在项目根目录发起开放式、多轮、持久的 Codex 对话，获得与 codex-cli 接近的完整交互体验，同时保留本项目的 Web UI、日志、思考过程、工具调用、输出流、权限审批、快捷指令、文件引用与审计能力。

本设计遵循两个已确认的产品决策：

1. 默认保留当前安全边界；仅当用户显式开启「完整 CLI 等价模式」时才允许 `danger-full-access`、网络访问与 Git 写操作。
2. 自由对话默认直接工作在主项目目录 `project.repoPath`；可选使用隔离 worktree 的安全模式。

## 2. 现状与差距

### 2.1 可复用能力

- [app-server-runtime.ts](../apps/server/src/services/app-server-runtime.ts) 已实现 App Server 进程、JSON-RPC、线程创建/恢复、turn 启动/中断和通知分发。
- [ServerNotification.ts](../packages/codex-protocol/src/generated/ServerNotification.ts) 已包含 reasoning、agent message、command、file change、MCP、token usage、compaction 等协议类型。
- [execution-service.ts](../apps/server/src/services/execution-service.ts) 已有审批等待、决策和事件发布。
- [event-bus.ts](../apps/server/src/services/event-bus.ts) 与 `/api/ws` 已具备全局 WebSocket 广播。
- [db.ts](../apps/server/src/db.ts) 已有迁移机制。

### 2.2 必须弥补的差距

- Bugfix 领域模型和线性状态机不能承载任意对话。
- 现有编排器按 analyze/implement/planQuestion 三个固定阶段运行，并且每个阶段关闭 runtime。
- 运行事件只以原始 method/payload 存储，前端缺少结构化渲染。
- 前端没有消息时间线、composer、文件引用、快捷指令等聊天 UI。
- ServerRequest 路由只处理少量审批方法，无法覆盖 `item/tool/call`、`mcpServer/elicitation/request` 等完整能力。
- 安全策略只针对 worktree bugfix 场景。

## 3. 设计原则

1. **平级新增，不侵入 bugfix**：新增 conversation 域，不复用 task 状态机，也不修改 bugfix 现有数据库表。
2. **协议透明**：所有 App Server 能力经统一 `AppServerRuntime` 暴露，服务层只做编排。
3. **事件源式存储**：保留原始事件用于审计与回填，同时生成结构化 item/message 用于 UI。
4. **长期进程 + 持久线程**：一个活跃对话对应一个长期 App Server 进程，可恢复、可中断、可回收。
5. **审批与澄清通用化**：以 `scopeId` 区分 task 和 conversation。
6. **安全默认，显式放权**：默认 `workspace-write`、`on-request`、`user`；完整模式需显式开启。

## 4. 领域模型

### 4.1 Conversation

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 对话主键 |
| projectId | UUID | 所属项目 |
| title | string | 对话标题 |
| codexThreadId | string | Codex 持久化 thread id |
| status | string | `IDLE`/`RUNNING`/`WAITING_APPROVAL`/`WAITING_CLARIFICATION`/`FAILED`/`ARCHIVED` |
| sandboxMode | string | `read-only`/`workspace-write`/`danger-full-access` |
| networkAccess | boolean | 是否启用网络 |
| approvalPolicy | string | `on-request`/`never`/`untrusted`/`granular` |
| approvalsReviewer | string | `user`/`auto_review`/`guardian_subagent` |
| model | string | 可选模型 |
| reasoningEffort | string | 可选 reasoning effort |
| baseInstructions | string | 系统指令 |
| developerInstructions | string | 开发者指令 |
| createdAt/updatedAt | datetime | 时间戳 |

### 4.2 Turn / Item / Event

- `ConversationTurn`：一次 turn，保存 codex turn id、状态、模型、effort、错误与耗时。
- `ConversationItem`：turn 内结构化条目，类型包括 `agentMessage`、`reasoning`、`plan`、`commandExecution`、`fileChange`、`mcpToolCall`、`dynamicToolCall`、`webSearch`、`imageGeneration`、`contextCompaction` 等。
- `ConversationEvent`：原始通知事件，带 seq、dedupe_key、method、payload 和 item/turn 关联。

### 4.3 审批与澄清

- `ConversationApproval`：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` 的持久化审批记录。
- `ConversationClarification`：`item/tool/requestUserInput` 的表单请求、答案与状态。

## 5. 数据模型

新增 migration version 5。表结构见 [arbitrary-chat-implementation.md](./arbitrary-chat-implementation.md) 阶段 2。

核心索引：

- `conversations(project_id)`
- `conversation_turns(conversation_id)`
- `conversation_items(conversation_id, seq)`
- `conversation_events(conversation_id, seq)`
- `conversation_approvals(conversation_id)`
- `conversation_clarifications(conversation_id)`

## 6. 后端架构

### 6.1 AppServerRuntime 扩展

在现有基础上补充：

- `startThread`、`resumeThread` 保持，但增加 `excludeTurns` 可选控制。
- `startTurn` 支持完整 `input`、`model`、`effort`、`sandboxPolicy`、`approvalPolicy`、`approvalsReviewer`。
- `steerTurn(threadId, turnId, input)`。
- `readThread(threadId)`、`listTurns(threadId, params)`、`listItems(threadId, params)`。
- `forkThread`、`archiveThread`、`deleteThread`、`setThreadName`。
- `compactThread`、`listModels`、`fuzzyFileSearch`。
- 暴露 `activeTurnId` 和最近状态。

### 6.2 ConversationRuntimeManager

职责：

- 每个活跃 conversation 持有唯一 `AppServerRuntime`。
- 单对话 turn 串行化。
- 支持 steer、interrupt、close。
- 记录 pid、threadId、activeTurnId、lastSeenAt。
- 空闲回收与最大并发限制。
- 服务重启后根据 `codexThreadId` 恢复。

### 6.3 ConversationService

对上层提供：

- 创建、读取、更新、删除、归档对话。
- 发送消息与 turn 生命周期。
- 历史回填与分页读取。
- fork、compact、rename、policy。
- 审批、澄清。

### 6.4 ServerRequestRouter

处理所有 App Server 请求：

| 请求 | 处理方式 |
|---|---|
| `item/commandExecution/requestApproval` | 审批协调器 |
| `item/fileChange/requestApproval` | 审批协调器 |
| `item/permissions/requestApproval` | 审批协调器 |
| `item/tool/requestUserInput` | 澄清协调器 |
| `item/tool/call` | DynamicToolRegistry |
| `mcpServer/elicitation/request` | 表单/审批桥接 |
| 其他配置/账号类请求 | 按能力路由或显式错误 |

### 6.5 DynamicToolRegistry

第一版支持：

- `fs/readFile`、`fs/writeFile`、`fs/readDirectory`、`fs/getMetadata`
- `fuzzyFileSearch`
- `gitDiffToRemote`
- 未知动态工具返回明确失败并记录事件

## 7. API 设计

### 7.1 REST

```text
GET    /api/projects/:projectId/conversations
POST   /api/projects/:projectId/conversations
GET    /api/conversations/:id
PATCH  /api/conversations/:id
DELETE /api/conversations/:id

POST   /api/conversations/:id/messages
POST   /api/conversations/:id/steer
POST   /api/conversations/:id/interrupt

GET    /api/conversations/:id/turns
GET    /api/conversations/:id/turns/:turnId/items
GET    /api/conversations/:id/events

POST   /api/conversations/:id/fork
POST   /api/conversations/:id/compact
POST   /api/conversations/:id/archive
POST   /api/conversations/:id/name

GET    /api/conversations/:id/models
GET    /api/conversations/:id/approvals
POST   /api/conversations/:id/approvals/:approvalId/decision
GET    /api/conversations/:id/clarification
POST   /api/conversations/:id/clarification

GET    /api/projects/:projectId/fs/search?query=...
```

### 7.2 WebSocket

事件包增加 scope：

```json
{
  "type": "conversation.event.created",
  "scope": { "kind": "conversation", "id": "conv-id" },
  "seq": 42,
  "payload": {},
  "emittedAt": "ISO"
}
```

## 8. 事件归一化

事件类型：

```text
user.message
agent.message.delta
agent.message.completed
reasoning.summary.delta
reasoning.text.delta
plan.delta
command.started
command.output.delta
command.completed
fileChange.patchUpdated
mcpTool.progress
mcpTool.completed
dynamicTool.completed
webSearch.updated
imageGeneration.updated
tokenUsage.updated
compaction.started
warning
error
approval.requested
approval.resolved
clarification.requested
clarification.answered
turn.started
turn.completed
```

## 9. 前端设计

新增路由：

```text
/projects/:projectId/chat
/projects/:projectId/chat/:conversationId
```

主要组件：

- `ConversationListPage`
- `ConversationPage`
- `ConversationComposer`
- `MessageTimeline`
- `ReasoningBlock`
- `AgentMessageBlock`
- `CommandBlock`
- `FileChangeBlock`
- `McpToolBlock`
- `ApprovalInline`
- `ClarificationInline`
- `QuickCommandPalette`
- `FileMentionPicker`
- `ActivityInspector`
- `ConversationPolicyPanel`

## 10. 安全与策略

### 默认策略

```text
sandboxMode = workspace-write
networkAccess = false
approvalPolicy = on-request
approvalsReviewer = user
```

### 完整 CLI 等价模式

需要用户在对话策略面板显式确认：

```text
sandboxMode = danger-full-access
networkAccess = true
allowGitWrites = true
approvalPolicy = on-request
```

策略变更必须记录到 `conversation_events`。

## 11. 可靠性

- 所有事件先持久化，再通过 WebSocket 广播。
- 使用 `dedupe_key` 和 seq 保证回填幂等。
- 后端重启后用 `codexThreadId` + `thread/resume` 恢复。
- 进程崩溃时清理进程树，等待用户下一条消息时重建。
- 同一 conversation 只允许一个活跃 turn。
- 空闲 10 分钟后回收 runtime，但保留 thread 与历史。

## 12. 验收概览

完整分阶段验收见 [arbitrary-chat-implementation.md](./arbitrary-chat-implementation.md)。

最终系统验收必须包含：

1. `pnpm -r typecheck`
2. `pnpm -r test`
3. 对话服务单测与集成测试全绿
4. Web 组件测试全绿
5. 使用本地 fixture 项目的真实 Codex 端到端验收
6. 运行时进程恢复与中断验收
7. 安全策略验收：默认拒绝危险操作，完整模式显式开启后可用
