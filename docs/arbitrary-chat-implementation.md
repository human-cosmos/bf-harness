# 项目自由对话实施与验收计划

本文是 [arbitrary-chat-design.md](./arbitrary-chat-design.md) 的落地实施计划。每个阶段都包含：

- 前置条件
- 实施内容
- 涉及文件
- 测试命令
- 通过标准
- 验收清单

## 0. 基线验收

### 命令

```bash
pnpm -r typecheck
pnpm -r test
```

### 通过标准

- 所有 workspace typecheck 通过
- 所有现有单元/集成测试通过

## 阶段 1：分支与共享领域模型

### 实施内容

1. 创建并切换分支 `codex/arbitrary-chat`。
2. 在 `packages/shared/src` 增加 conversation 类型和 zod schema。
3. 新增统一测试，验证 schema、策略默认值和状态转换。

### 涉及文件

- `packages/shared/src/conversation.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/conversation.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/shared test
pnpm --filter @bugfix-harness/shared typecheck
```

### 通过标准

- `conversation.test.ts` 全部通过
- shared typecheck 通过

### 验收清单

- 对话创建 schema 校验有效输入和无效输入
- 策略默认值与设计一致
- 消息 input 转换函数返回可持久化结构

## 阶段 2：数据库迁移与 Repository

### 实施内容

1. 在 `db.ts` 增加 migration 5。
2. 新增 conversation repository、turn repository、item repository、event repository、approval repository、clarification repository。
3. 为 repository 增加集成测试。

### 表结构

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  codex_thread_id TEXT,
  status TEXT NOT NULL,
  sandbox_mode TEXT NOT NULL,
  network_access INTEGER NOT NULL,
  approval_policy TEXT NOT NULL,
  approvals_reviewer TEXT NOT NULL,
  model TEXT,
  reasoning_effort TEXT,
  base_instructions TEXT,
  developer_instructions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  codex_turn_id TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  error_json TEXT,
  started_at_ms INTEGER,
  completed_at_ms INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversation_items (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  codex_turn_id TEXT,
  codex_item_id TEXT,
  parent_item_id TEXT,
  item_type TEXT NOT NULL,
  role TEXT,
  author TEXT,
  title TEXT,
  status TEXT,
  payload_json TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at_ms INTEGER,
  completed_at_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  codex_thread_id TEXT,
  codex_turn_id TEXT,
  codex_item_id TEXT,
  method TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT,
  seq INTEGER NOT NULL,
  emitted_at_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_approvals (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  codex_turn_id TEXT,
  codex_item_id TEXT,
  codex_request_id INTEGER,
  method TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  decision TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_clarifications (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  codex_request_id INTEGER,
  codex_turn_id TEXT,
  codex_item_id TEXT,
  questions_json TEXT NOT NULL,
  answers_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversation_turns_conversation ON conversation_turns(conversation_id);
CREATE INDEX idx_conversation_items_conversation_seq ON conversation_items(conversation_id, seq);
CREATE INDEX idx_conversation_items_thread_turn ON conversation_items(codex_turn_id);
CREATE INDEX idx_conversation_events_conversation_seq ON conversation_events(conversation_id, seq);
CREATE INDEX idx_conversation_approvals_conversation ON conversation_approvals(conversation_id);
CREATE INDEX idx_conversation_clarifications_conversation ON conversation_clarifications(conversation_id);
```

### 涉及文件

- `apps/server/src/db.ts`
- `apps/server/src/repositories/conversation-repository.ts`
- `apps/server/src/repositories/conversation-turn-repository.ts`
- `apps/server/src/repositories/conversation-item-repository.ts`
- `apps/server/src/repositories/conversation-event-repository.ts`
- `apps/server/src/repositories/conversation-approval-repository.ts`
- `apps/server/src/repositories/conversation-clarification-repository.ts`
- `apps/server/test/conversation-repositories.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-repositories
pnpm --filter @bugfix-harness/server typecheck
```

### 通过标准

- migration 5 应用成功
- repository 能创建、读取、分页、更新对话及子实体
- conversation_events seq 按 conversation 单调递增

### 验收清单

- 新建对话返回持久化记录
- 按 projectId 列出对话
- 写入 turn/item/event/approval/clarification 后可读回
- 重启打开数据库后数据仍存在

## 阶段 3：AppServerRuntime 通用能力扩展

### 实施内容

1. 在 `AppServerRuntime` 增加：
   - `steerTurn`
   - `readThread`
   - `listTurns`
   - `listItems`
   - `forkThread`
   - `archiveThread`
   - `setThreadName`
   - `compactThread`
   - `listModels`
   - `fuzzyFileSearch`
2. 修正 ServerRequest 默认响应，避免不支持的请求挂起。
3. 增加运行时 mock/child process 测试。

### 涉及文件

- `apps/server/src/services/app-server-runtime.ts`
- `apps/server/test/app-server-runtime.test.ts`
- `apps/server/test/conversation-runtime.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- app-server-runtime conversation-runtime
pnpm --filter @bugfix-harness/server typecheck
```

### 通过标准

- 新增 RPC 方法正确发送对应 `method` 和参数
- 响应与通知仍可解析
- 未实现请求不会被永久阻塞

### 验收清单

- `readThread/listTurns/listItems` 方法覆盖生成协议参数
- `steerTurn` 可向活跃 turn 注入输入
- `fuzzyFileSearch` 返回候选文件

## 阶段 4：ConversationService 与 RuntimeManager

### 实施内容

1. 实现 `ConversationRuntimeManager`：进程复用、串行 turn、中断、空闲回收。
2. 实现 `ConversationService`：创建、读取、发送消息、中断、fork、compact、rename、archive。
3. 实现事件摄入，将 App Server 通知写入 conversation_events 并广播。
4. 实现基础结构化 item 创建：agentMessage、reasoning、plan、commandExecution、fileChange、tokenUsage。

### 涉及文件

- `apps/server/src/services/conversation-runtime-manager.ts`
- `apps/server/src/services/conversation-service.ts`
- `apps/server/src/services/conversation-event-ingestor.ts`
- `apps/server/src/services/dynamic-tool-registry.ts`
- `apps/server/test/conversation-service.test.ts`
- `apps/server/test/conversation-event-ingestor.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-service conversation-event-ingestor
pnpm --filter @bugfix-harness/server typecheck
```

### 通过标准

- 服务可创建对话、持久化 threadId
- 发送消息启动 turn 并产生事件
- 中断能终止当前 turn
- 同一对话并发发送被拒绝或排队
- 事件摄入器可归一化至少 8 类协议通知

### 验收清单

- 发送文本消息后生成 `user.message`、`turn.started`、`agent.message.delta`、`turn.completed`
- 命令输出以 `command.output.delta` 存储
- 文件变更生成 `fileChange.patchUpdated`
- 审批与澄清生成对应事件
- 未知事件仅记录原始 event，不阻塞主流程

## 阶段 5：通用审批与澄清

### 实施内容

1. 抽取或新增 `ConversationInteractionCoordinator`。
2. 处理 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`。
3. 处理 `item/tool/requestUserInput`。
4. 支持 accept/decline/cancel 及 `acceptForSession`、execpolicy/network amendment。

### 涉及文件

- `apps/server/src/services/conversation-interaction-coordinator.ts`
- `apps/server/src/services/approval-policy.ts`（如需要扩展）
- `apps/server/test/conversation-interaction.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-interaction
pnpm --filter @bugfix-harness/server typecheck
```

### 通过标准

- 审批请求持久化并可等待决策
- 决策写入数据库并返回正确 App Server response
- 澄清请求可保存答案并继续 turn
- 默认拒绝未授权网络/危险命令

### 验收清单

- `item/commandExecution/requestApproval` 正确映射命令、网络、stdin 类型
- `item/fileChange/requestApproval` 正确映射文件写入
- `item/permissions/requestApproval` 正确映射额外权限
- `item/tool/requestUserInput` 正确映射问题表单

## 阶段 6：REST API 与 WebSocket

### 实施内容

1. 在 `app.ts` 增加 conversation 路由。
2. 扩展 `/api/ws` 事件为带 scope 的统一结构。
3. 保持现有 bugfix 事件兼容。

### 涉及文件

- `apps/server/src/app.ts`
- `apps/server/src/index.ts`
- `apps/server/test/conversation-api.test.ts`
- `apps/server/test/websocket-conversation.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-api websocket-conversation
pnpm --filter @bugfix-harness/server typecheck
```

### 通过标准

- REST 接口状态码、请求体校验、404 行为正确
- WebSocket 事件包含 scope，可按 conversationId 过滤
- 现有 bugfix 事件测试仍通过

### 验收清单

- 创建、读取、更新、删除对话
- 发送消息返回 202 和 turnId
- 中断、fork、compact、rename、archive 端点可用
- 审批、澄清、事件分页端点可用

## 阶段 7：Web 端入口与基础聊天 UI

### 实施内容

1. 扩展 `api.ts` 类型与请求方法。
2. 新增 `useConversationEvents`。
3. 新增 `ConversationListPage`、`ConversationPage`、`ConversationComposer`、`MessageTimeline`。
4. 路由接入 `/projects/:projectId/chat` 和 `/projects/:projectId/chat/:conversationId`。

### 涉及文件

- `apps/web/src/api.ts`
- `apps/web/src/use-conversation-events.ts`
- `apps/web/src/conversation-pages.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/conversation-pages.test.tsx`

### 测试命令

```bash
pnpm --filter @bugfix-harness/web test
pnpm --filter @bugfix-harness/web typecheck
```

### 通过标准

- 页面渲染、发送消息、展示消息流、显示连接状态
- composer 禁用状态和错误提示正确
- 路由不存在时返回 404

### 验收清单

- 从项目页进入对话列表
- 创建新对话
- 发送文本消息
- 实时显示 Agent 输出
- 断开重连后仍能加载历史

## 阶段 8：结构化渲染与完整交互

### 实施内容

1. 实现 `ReasoningBlock`、`CommandBlock`、`FileChangeBlock`、`McpToolBlock`。
2. 实现 `ActivityInspector`、`TokenUsageBadge`。
3. 实现 `ApprovalInline`、`ClarificationInline`。

### 涉及文件

- `apps/web/src/conversation-blocks.tsx`
- `apps/web/src/conversation-blocks.test.tsx`

### 测试命令

```bash
pnpm --filter @bugfix-harness/web test
pnpm --filter @bugfix-harness/web typecheck
```

### 通过标准

- 各类 block 均能渲染已知 fixture payload
- 命令输出、diff、MCP 调用可折叠展开
- 审批和澄清表单可提交

### 验收清单

- 思考内容默认折叠
- 命令卡展示 cwd、命令、输出、退出码、耗时
- 文件变更卡展示 diff
- 审批卡展示 accept/decline/cancel
- 澄清卡展示问题与答案

## 阶段 9：快捷指令与文件引用

### 实施内容

1. 实现 `QuickCommandPalette`。
2. 实现 `/` 快捷指令映射。
3. 实现 `FileMentionPicker`。
4. 后端增加 `/api/projects/:projectId/fs/search`。
5. 输入层将 mention 转换为 `UserInput`。

### 涉及文件

- `apps/web/src/quick-command-palette.tsx`
- `apps/web/src/file-mention-picker.tsx`
- `apps/web/src/conversation-pages.tsx`
- `apps/web/src/api.ts`
- `apps/server/src/app.ts`
- `apps/server/test/conversation-fs-search.test.ts`
- `apps/web/src/file-mention-picker.test.tsx`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-fs-search
pnpm --filter @bugfix-harness/web test
pnpm --filter @bugfix-harness/web typecheck
```

### 通过标准

- 文件搜索返回仓库内匹配文件
- `@` 选择后转换为 mention/text_elements
- 每个快捷指令能触发正确 API 或 UI 状态

### 验收清单

- `/model` 打开模型选择器
- `/policy` 打开策略面板
- `/compact` 触发压缩
- `/fork` 创建新对话
- `/interrupt` 中断当前 turn
- `/diff` 显示当前 diff
- `@` 输入文件路径并发送

## 阶段 10：策略面板与安全模式

### 实施内容

1. 实现 `ConversationPolicyPanel`。
2. 后端校验策略变更，写入事件。
3. 实现默认安全边界和完整 CLI 等价模式。

### 涉及文件

- `apps/web/src/conversation-policy-panel.tsx`
- `apps/server/src/services/conversation-service.ts`
- `apps/server/test/conversation-policy.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-policy
pnpm --filter @bugfix-harness/web test
```

### 通过标准

- 默认策略为 workspace-write、network off、on-request
- 完整模式需显式开启
- 策略变更被持久化并生成事件
- 非法策略组合被拒绝

### 验收清单

- 默认禁止 commit/push/MR
- 完整模式显式开启后才允许 danger-full-access/network
- 策略面板正确显示当前策略

## 阶段 11：恢复与可靠性

### 实施内容

1. 服务重启后恢复 conversation thread。
2. 使用 `thread/read`、`thread/turns/list`、`thread/items/list` 回填历史。
3. 进程崩溃后的清理与重建。
4. 空闲回收。

### 涉及文件

- `apps/server/src/services/conversation-runtime-manager.ts`
- `apps/server/src/services/conversation-service.ts`
- `apps/server/test/conversation-recovery.test.ts`

### 测试命令

```bash
pnpm --filter @bugfix-harness/server test -- conversation-recovery
pnpm --filter @bugfix-harness/server typecheck
```

### 通过标准

- 已知 threadId 可恢复并继续发送消息
- 历史回填幂等
- 崩溃后不丢本地已持久化事件
- 空闲 runtime 被回收，但对话记录仍在

### 验收清单

- 重启后打开已有对话可看到历史
- 继续发送消息使用同一 codex thread
- 重复回填不产生重复事件

## 阶段 12：端到端完整验收

### 实施内容

1. 编写真实 Codex 端到端脚本 `apps/server/scripts/conversation-e2e-acceptance.ts`。
2. 使用本地 fixture 项目验证完整流程。
3. 修复所有发现的问题并重新测试。

### 测试命令

```bash
pnpm -r typecheck
pnpm -r test
pnpm --filter @bugfix-harness/server accept:conversation
pnpm e2e
```

### 通过标准

- 所有 typecheck 与单元/集成测试通过
- conversation 端到端输出 `CONVERSATION_E2E_OK`
- Playwright 关键页面可用
- 真实对话可以完成：创建、消息、工具调用、审批、文件变更、恢复

### 最终验收清单

1. 项目页可进入自由对话
2. 可创建多个对话并恢复
3. 可发送文本、文件引用和快捷指令
4. Agent 输出、思考、计划、命令、文件变更、MCP 工具均可见
5. 审批、澄清可以交互并继续 turn
6. 中断、fork、compact、rename、archive 可用
7. 默认安全策略生效
8. 完整模式显式开启后能力可用
9. 服务重启后对话与历史恢复
10. 现有 bugfix 功能回归通过
