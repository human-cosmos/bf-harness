# Bugfix Harness V1 开发计划

## 1. 目标与范围

本计划依据 `bugfix-harness-v1.md` 的 `APPROVED` 需求基线，将开发过程划分为 M0-M5。核心原则：

1. 业务状态机和 Git Worktree 由 Harness 掌控；
2. Codex 只通过 `codex-harness app-server` 接入；
3. 在验证完 App Server 高风险能力前，不进入领域层和 UI 的正式实现；
4. 所有子任务均有可核验的验收标准。

## 2. 里程碑总览

| 里程碑 | 目标 | 主要退出标准 |
|---|---|---|
| M0 | 完成 5 个协议验证 | 5 个验证脚本可重复运行并留下证据 |
| M1 | 领域模型、SQLite、Git Worktree | 项目/任务可持久化；Worktree 隔离可用 |
| M2 | 状态机和计划确认门 | 未批准计划前无法进入实施阶段 |
| M3 | 审批、验证、Diff、报告 | 审批矩阵、验证执行、Diff 展示、报告关联可用 |
| M4 | Web UI | 需求第 10 节页面全部可用 |
| M5 | 可靠性、安全、验收 | AC-001 ~ AC-005 全部通过 |

每个子任务的验收条目统一包含：

```text
前置条件
输入 / 输出
成功标准
异常场景
测试证据
关联需求
```

---

## 3. M0：协议验证

### V1 `outputSchema` 结构化输出

**前置条件**

- `codex-harness` 可用
- 已通过 `initialize` / `initialized`
- App Server 以 `read-only` 沙箱运行

**输入 / 输出**

- 输入：一个只允许 `status`、`message` 字段的 JSON Schema
- 输出：Agent 最终消息文本

**成功标准**

```gherkin
Given 一个 Turn 使用 outputSchema 启动
When Turn 完成
Then 最终消息是可解析的 JSON
And JSON 满足 outputSchema
And 不包含 schema 之外的字段
```

**异常场景**

- 最终消息被包在 markdown code fence 中：必须能剥离后解析
- 最终消息不是 JSON：标记为协议失败，不进入实施阶段
- schema 必填字段缺失：标记为解析失败

**测试证据**

- `protocol-spike/validations/v1-output-schema.mjs`
- 输出中包含 `PASS`，且记录 `turnStatus=completed`

**关联需求**

- FR-003、FR-007、FR-011

### V2 单 Thread 多 Turn 工作流与 `turn/interrupt`

**前置条件**

- 已通过 V1
- 存在一个持久化 Thread

**输入 / 输出**

- 输入：同一 `threadId` 下的连续多个 `turn/start`
- 输出：每个 Turn 的 `turn/completed` 状态；中断后的 `turn/completed` 状态

**成功标准**

```gherkin
Given 一个 Thread 已创建
When 在同一 Thread 连续启动两个 Turn
Then 两个 Turn 均能完成
And 第二个 Turn 可读取第一个 Turn 的上下文

Given 一个正在运行的 Turn
When Harness 调用 turn/interrupt
Then 该 Turn 最终状态为 interrupted
And App Server 不再继续产生该 Turn 的模型事件
```

**异常场景**

- `turn/interrupt` 时 Turn 尚未开始：不得崩溃，需返回明确错误或忽略
- Turn 已自然完成：中断请求应被幂等处理
- 中断后 App Server 仍需可继续下一个 Turn

**测试证据**

- `protocol-spike/validations/v2-multiturn-interrupt.mjs`
- 输出中包含 `multi-turn PASS` 和 `interrupt PASS`

**关联需求**

- FR-006、FR-007、FR-012、ER-003

### V3 Git Worktree + `cwd` + Diff

**前置条件**

- 存在一个已完成初始提交的本地 Git 仓库
- 可创建独立 Worktree

**输入 / 输出**

- 输入：主仓库路径、baseline commit、Worktree 路径
- 输出：Worktree 内文件变更、主仓库工作区状态、统一 Diff

**成功标准**

```gherkin
Given 一个 Git 仓库
When Harness 创建 Worktree 并让 Agent 在 Worktree 内写入文件
Then Agent 写入的文件只出现在 Worktree
And 主仓库工作区保持干净
And Harness 可以生成该文件的 Diff
```

**异常场景**

- Worktree 路径已存在：不得复用，必须报错
- baseline commit 无效：不得创建 Worktree
- Agent 试图写 Worktree 外文件：必须被拒绝
- 新文件未跟踪时：仍能通过 `git diff --no-index` 或 `git status` 生成变更证据

**测试证据**

- `protocol-spike/validations/v3-worktree-diff.mjs`
- 输出中包含 `worktreeCreated=true`、`originalUntouched=true`、`originalClean=true`、`diffLines>0`

**关联需求**

- FR-004、FR-009、ER-005

### V4 Thread 记录恢复

**前置条件**

- 已有一个完成的 Thread 和 Turn
- 已知 `threadId` 和 `turnId`

**输入 / 输出**

- 输入：App Server 重启、已知 Thread/Turn ID
- 输出：`thread/read`、`thread/turns/list`、`thread/items/list`、`thread/loaded/list` 结果

**成功标准**

```gherkin
Given App Server 重启
When Harness 按 threadId 查询历史
Then 可以读回 Thread
And 可以读回 Turn
And 可以读回 Item
And 该 Thread 不在 loaded 列表
And Harness 不会自动续跑原 Turn
```

**异常场景**

- App Server 未干净退出：下一次启动仍应能读回持久化记录
- threadId 不存在：返回明确未找到错误，不创建新 Thread
- 历史分页数据缺失：不得误报为完成

**测试证据**

- `protocol-spike/validations/v4-restart-recovery.mjs`
- 输出中包含 `recovered=true`、`hasTurn=true`、`hasItem=true`、`notLoaded=true`

**关联需求**

- FR-006、FR-013、ER-002、ER-003、OD-004

### V5 审批风险矩阵

**前置条件**

- 存在规范化后的审批请求
- 存在 Worktree 根、允许路径、禁止路径、计划路径和项目验证命令

**输入 / 输出**

- 输入：`command`、`file`、`network`、`permissions` 类型审批请求
- 输出：`autoAllow`、`prompt`、`deny` 之一及原因

**成功标准**

```gherkin
Given 风险策略上下文
When 收到文件、命令、网络或权限审批
Then 策略返回稳定且可解释的风险等级
And Git Commit/Push/MR 永久为 deny
And Worktree 外路径永久为 deny
```

**异常场景**

- 命令为空：不得崩溃，默认 `deny`
- 路径为非绝对路径：默认 `deny`
- 未知请求类型：默认 `deny`
- 路径包含 `..` 或符号链接绕过：策略层必须 fail closed

**测试证据**

- `protocol-spike/validations/v5-approval-matrix.test.mjs`
- 12 个测试全部通过

**关联需求**

- FR-008、NFR-001、OD-003

---

## 4. M1：领域层、存储与 Git Worktree

### T1.1 pnpm Monorepo 工程骨架

**前置条件**

- Node.js 22+、pnpm 可用

**输入 / 输出**

- 输入：仓库目录结构定义
- 输出：`apps/web`、`apps/server`、`packages/shared`、`packages/codex-protocol`

**成功标准**

```gherkin
Given 一个干净仓库
When 执行 pnpm install
Then 所有 workspace 可安装依赖
And 每个包可通过 package.json 脚本独立运行
And shared 和 codex-protocol 可被 server/web 正常引用
```

**异常场景**

- workspace 依赖循环：`pnpm install` 必须失败并给出明确提示
- 协议生成产物缺失：构建必须失败，不得使用过期类型

**测试证据**

- `pnpm install` 成功
- `pnpm -r typecheck` 成功
- CI 中 workspace 构建任务通过

**关联需求**

- NFR-003

### T1.2 SQLite Schema 与 Migration

**前置条件**

- 已确定领域对象和关系

**输入 / 输出**

- 输入：领域对象定义
- 输出：`projects`、`tasks`、`task_contracts`、`workflow_runs`、`stage_runs`、`worktrees`、`agent_sessions`、`agent_events`、`approval_requests`、`validation_results`、`artifacts`、`delivery_reports` 表及索引

**成功标准**

```gherkin
Given 空数据库
When 运行 migration
Then 所有表和索引创建成功
And schema_version 正确写入
And 已有数据可通过升级 migration 保留
```

**异常场景**

- migration 中断：必须可回滚或重入
- 版本冲突：应用启动必须失败并提示
- 外键约束缺失：测试必须失败
- 文本超过限制：必须截断或转存文件，不静默丢数据

**测试证据**

- migration 单元测试
- 空库升级、旧版本升级、失败回滚测试
- `PRAGMA foreign_keys=ON` 验证

**关联需求**

- FR-001、FR-004、FR-013、NFR-002、NFR-006

### T1.3 领域模型与 zod Schema

**前置条件**

- T1.2 已通过

**输入 / 输出**

- 输入：需求中的 Project、BugfixTask、TaskContract 字段
- 输出：TypeScript 领域类型、zod schema、数据库映射

**成功标准**

```gherkin
Given 非法输入
When 经过 zod schema
Then 输入被拒绝并返回字段级错误
Given 合法输入
When 保存和读取
Then 数据往返后字段保持一致
```

**异常场景**

- 可选字段缺失、未知字段、错误类型
- 必填字段为空字符串
- 任务 ID 重复
- 路径不是绝对路径

**测试证据**

- zod schema 单元测试
- 数据库往返测试
- 未知字段拒绝测试

**关联需求**

- FR-001、FR-002、FR-003、NFR-001

### T1.4 Git Worktree Manager

**前置条件**

- 本地 Git 可用

**输入 / 输出**

- 输入：仓库路径、任务 ID、baseline commit
- 输出：Worktree 路径、创建结果、失败原因

**成功标准**

```gherkin
Given 有效 Git 仓库
When 创建 Worktree
Then 新 Worktree 位于 Harness 管理目录
And 主仓库工作区不变
And baseline commit 被记录
Given 创建失败
When 清理流程执行
Then 不完整资源被清理
And 不允许落回直接修改主工作区
```

**异常场景**

- 仓库不是 Git 仓库
- baseline commit 不存在
- Worktree 路径已存在
- 分支名冲突
- 磁盘空间不足
- 清理失败

**测试证据**

- 成功创建测试
- 每种异常场景测试
- 主仓库 `git status --porcelain` 保持干净

**关联需求**

- FR-004、ER-005、OD-003

---

## 5. M2：工作流与计划确认

### T2.1 任务状态机

**前置条件**

- T1.3、T1.4 已通过

**输入 / 输出**

- 输入：当前状态、事件
- 输出：新状态、状态迁移记录

**成功标准**

```gherkin
Given 合法状态迁移
When 提交事件
Then 状态原子更新
And 旧状态、新状态、时间、触发者、原因被记录
Given 非法状态迁移
When 提交事件
Then 迁移被拒绝
```

**异常场景**

- 重复提交同一迁移
- 从已结束状态再次迁移
- 状态迁移写入失败
- 并发更新

**测试证据**

- 全状态迁移单元测试
- 非法迁移拒绝测试
- 原子写入测试

**关联需求**

- FR-013、NFR-002

### T2.2 分析 Prompt 与 Plan JSON Schema

**前置条件**

- V1 已通过

**输入 / 输出**

- 输入：Bugfix 任务输入、项目规范
- 输出：分析阶段 Prompt、Plan JSON Schema、Plan JSON

**成功标准**

```gherkin
Given 任务契约
When 启动分析 Turn
Then Agent 在 read-only 沙箱运行
And 输出满足 Plan JSON Schema
And 关键信息不足时输出 openQuestions
```

**异常场景**

- Plan JSON 解析失败
- 必填字段缺失
- 修改范围超过允许路径
- 验证命令缺失
- 根因证据为空

**测试证据**

- 结构化和非结构化输出解析测试
- 计划字段完整性测试

**关联需求**

- FR-003、FR-007、NFR-003

### T2.3 计划批准、退回与取消

**前置条件**

- T2.2 已通过

**输入 / 输出**

- 输入：工程师决定 `approve` / `reject` / `cancel`
- 输出：状态迁移、审批记录、下一 Turn 输入

**成功标准**

```gherkin
Given 工程师批准计划
When 系统迁移到 IMPLEMENTING
Then 后续 Turn 使用 workspace-write 沙箱
Given 工程师退回计划
When 系统迁移到 ANALYZING
Then Agent 不得修改代码
And 退回意见进入下一分析 Turn
```

**异常场景**

- 批准时计划字段不完整
- 退回时未填写意见
- 取消时 Agent 仍运行
- 用户重复点击批准

**测试证据**

- AC-002 集成测试
- 审批幂等性测试

**关联需求**

- FR-007、FR-012、ER-003

---

## 6. M3：审批、验证、Diff 与报告

### T3.1 审批请求拦截器

**前置条件**

- V5 已通过

**输入 / 输出**

- 输入：App Server 审批请求
- 输出：`ApprovalRequest` 记录、响应结果

**成功标准**

```gherkin
Given App Server 发出审批请求
When 拦截器收到请求
Then 请求被规范化
And 被持久化
And 风险策略决定 autoAllow/prompt/deny
And App Server 收到对应响应
```

**异常场景**

- 响应超时
- 请求字段缺失
- App Server 重启导致请求丢失
- 同一请求重复到达

**测试证据**

- 审批拦截单元测试
- 超时测试
- 契约测试

**关联需求**

- FR-008、FR-013、NFR-001

### T3.2 风险策略引擎与默认矩阵

**前置条件**

- T3.1 已通过

**输入 / 输出**

- 输入：规范化审批请求、任务阶段、项目策略
- 输出：风险等级和原因

**成功标准**

```gherkin
Given 默认风险矩阵
When 匹配各操作类型
Then 读操作、声明验证命令、计划内修改 autoAllow
And 计划外修改、删除、依赖安装、网络 prompt
And Worktree 外修改、Git Commit/Push/MR deny
```

**异常场景**

- 命令包含多个风险特征：按最高风险处理
- 路径无法规范化：fail closed
- 项目策略与默认矩阵冲突：不得放宽默认限制

**测试证据**

- 12 个策略单元测试
- 组合风险和边界测试

**关联需求**

- FR-008、NFR-001

### T3.3 ValidationRunner

**前置条件**

- 项目已声明验证命令

**输入 / 输出**

- 输入：验证命令列表、Worktree 路径、超时配置
- 输出：`ValidationResult` 列表

**成功标准**

```gherkin
Given 验证命令
When 在 Worktree 内执行
Then 记录命令、cwd、起止时间、退出码、stdout、stderr
And 返回 passed/failed/timeout/skipped
And 不允许字符串拼接执行
```

**异常场景**

- 命令超时
- 命令不存在
- 输出过大
- Worktree 不存在
- 验证命令返回非零

**测试证据**

- 成功、失败、超时、跳过测试
- 大输出截断测试
- 命令参数数组验证

**关联需求**

- FR-005、FR-010、ER-004、NFR-001

### T3.4 `git diff` 生成与文件分类

**前置条件**

- 已有 Worktree 变更

**输入 / 输出**

- 输入：Worktree 路径
- 输出：文件列表、状态、统一 Diff、统计、计划外/敏感文件提示

**成功标准**

```gherkin
Given Worktree 中有文件变更
When 生成 Diff
Then 能区分新增、修改、删除
And 能识别计划外文件
And 能识别敏感文件
And 未跟踪文件也有变更证据
```

**异常场景**

- Diff 过大
- 二进制文件
- 空 Diff
- 权限不足

**测试证据**

- 文件分类测试
- 大 Diff 分页测试

**关联需求**

- FR-009、NFR-006

### T3.5 交付报告组装

**前置条件**

- 已有 Diff、验证结果、审批记录

**输入 / 输出**

- 输入：结构化报告 JSON、Diff、ValidationResult、Artifact
- 输出：`DeliveryReport`

**成功标准**

```gherkin
Given Agent 生成结构化报告
When Harness 组装报告
Then 报告与 Diff 和验证结果关联
And 不保存无法验证的自由文本
And 报告字段完整
```

**异常场景**

- 报告 JSON 解析失败
- 引用的 Diff 或验证结果不存在
- 报告缺少必填字段

**测试证据**

- 报告组装测试
- 关联完整性和缺失引用测试

**关联需求**

- FR-011、FR-013

### T3.6 验证失败自动修复

**前置条件**

- ValidationRunner 已通过

**输入 / 输出**

- 输入：验证失败结果、重试计数
- 输出：继续修复或进入 BLOCKED

**成功标准**

```gherkin
Given 验证失败
When 自动修复轮数小于 2
Then Agent 可继续实施修复
When 同一验证失败达到第 2 次
Then 任务进入 BLOCKED
And 等待工程师决定
```

**异常场景**

- 不同验证交替失败
- Agent 中断或异常退出
- 自动修复次数被持久化

**测试证据**

- 重试计数测试
- BLOCKED 迁移测试

**关联需求**

- ER-004、OD-002

---

## 7. M4：Web UI

### T4.1 React 前端工程与本地 API/WebSocket

**前置条件**

- M1 工程骨架完成

**输入 / 输出**

- 输入：本地后端 REST/WebSocket 接口
- 输出：可运行的 Web 应用

**成功标准**

```gherkin
Given 启动本地服务
When 浏览器访问应用
Then 前端可连接后端
And WebSocket 可实时接收事件
And 刷新后页面可恢复
```

**异常场景**

- 后端不可用
- WebSocket 断线重连
- 接口返回错误

**测试证据**

- Playwright 冒烟测试
- WebSocket 重连测试

**关联需求**

- NFR-004、NFR-003

### T4.2 项目列表与项目配置

**前置条件**

- Project CRUD API 可用

**输入 / 输出**

- 输入：项目名称、Git 路径、规范来源、验证命令、允许/禁止路径
- 输出：项目列表和配置表单

**成功标准**

```gherkin
Given 用户选择有效 Git 仓库
When 添加项目
Then 系统保存项目配置
And 不修改目标仓库
And 重启应用后项目仍存在
```

**异常场景**

- Git 路径无效
- 验证命令格式错误
- 允许/禁止路径冲突
- 删除正在使用的项目

**测试证据**

- FR-001 验收测试
- 表单校验测试

**关联需求**

- FR-001、FR-005

### T4.3 新建 Bugfix 任务

**前置条件**

- T4.2 已通过

**输入 / 输出**

- 输入：目标项目、任务标题、Bug 描述、当前行为、期望行为、可选信息
- 输出：任务契约预览

**成功标准**

```gherkin
Given 用户填写任务信息
When 创建任务
Then 必填字段被校验
And 系统生成任务契约
And 任务进入 DRAFT
```

**异常场景**

- 必填字段为空
- 相关文件不在项目内
- 验收条件缺失
- 重复创建

**测试证据**

- FR-002 验收测试
- zod schema 前端/后端一致测试

**关联需求**

- FR-002、FR-003

### T4.4 任务运行详情

**前置条件**

- AgentEvent API 可用

**输入 / 输出**

- 输入：taskId
- 输出：任务状态、阶段、Agent 事件流、Thread/Turn 信息

**成功标准**

```gherkin
Given 任务正在运行
When 打开详情页
Then 实时展示 Agent 事件
And 状态变化被及时更新
And 历史事件可分页查看
```

**异常场景**

- 任务不存在
- 事件流中断
- 大量事件到达

**测试证据**

- 事件流 E2E 测试
- 分页测试

**关联需求**

- FR-006、FR-013、NFR-004

### T4.5 计划确认

**前置条件**

- 分析 Turn 完成

**输入 / 输出**

- 输入：批准/退回意见/取消
- 输出：状态迁移和下一 Turn

**成功标准**

```gherkin
Given 已收到修复计划
When 工程师批准
Then 进入实施阶段
When 工程师退回
Then Agent 不修改代码
And 退回意见进入新分析 Turn
```

**异常场景**

- 计划字段不完整
- 用户重复提交
- 退回未填意见

**测试证据**

- AC-002 E2E 测试

**关联需求**

- FR-007、FR-012

### T4.6 操作审批

**前置条件**

- ApprovalRequest API 和 WebSocket 可用

**输入 / 输出**

- 输入：批准/拒绝
- 输出：审批决定和审计记录

**成功标准**

```gherkin
Given 存在待审批操作
When 工程师查看命令、原因和影响范围
Then 可以批准或拒绝
And 决定被记录
```

**异常场景**

- 审批超时
- 请求已消失
- 重复决定

**测试证据**

- AC-003 E2E 测试

**关联需求**

- FR-008、FR-013

### T4.7 Diff 与验证结果

**前置条件**

- Diff API 和 ValidationResult API 可用

**输入 / 输出**

- 输入：taskId
- 输出：文件 Diff、验证命令、退出码、输出、豁免入口

**成功标准**

```gherkin
Given 任务已实施和验证
When 打开 Diff 与验证页
Then 展示文件列表、Diff、变更统计
And 展示验证结果
And 失败或跳过项可被工程师豁免并记录原因
```

**异常场景**

- Diff 为空
- 验证输出过大
- 豁免未填写原因

**测试证据**

- 前端 Diff 渲染测试
- 验证豁免测试

**关联需求**

- FR-009、FR-010、OD-001

### T4.8 最终验收与交付报告

**前置条件**

- T4.7 已通过

**输入 / 输出**

- 输入：接受/退回/拒绝/取消
- 输出：最终状态和报告展示

**成功标准**

```gherkin
Given 报告、Diff 和验证证据可用
When 工程师选择接受
Then 任务进入 ACCEPTED
And 不执行 Git Commit/Push/MR
When 工程师拒绝
Then 任务进入 REJECTED
And 所有记录保留
```

**异常场景**

- 必需验证未通过
- 存在未豁免跳过项
- 报告字段缺失

**测试证据**

- AC-001、AC-004 E2E 测试

**关联需求**

- FR-011、FR-012、OD-001

### T4.9 基础设置与 Runtime 诊断

**前置条件**

- `codex-harness` 诊断接口可用

**输入 / 输出**

- 输入：用户查看诊断
- 输出：Codex 可用性、配置、工作区、日志清理入口

**成功标准**

```gherkin
Given 打开设置页
When Codex Runtime 可用或不可用
Then 页面显示明确状态
And 不可用时给出安装/配置指引
And 可手动清理日志、产物和 Worktree
```

**异常场景**

- 诊断命令超时
- 日志清理时任务正在运行
- 清理前未二次确认

**测试证据**

- 诊断页单元测试
- 清理二次确认测试

**关联需求**

- ER-001、NFR-006

---

## 8. M5：可靠性、安全与验收

### T5.1 进程树管理与崩溃恢复

**前置条件**

- App Server 以子进程运行

**输入 / 输出**

- 输入：应用退出、App Server 崩溃
- 输出：无孤儿进程、失败状态记录、重启恢复

**成功标准**

```gherkin
Given 任务正在运行
When 桌面应用或本地服务异常退出
Then App Server 进程树被终止
And 任务记录保留
And 重启后显示未完成任务
And 不自动续跑原 Session
```

**异常场景**

- 子进程无法结束
- Windows 进程树残留
- 崩溃发生在状态写入前

**测试证据**

- 进程树清理测试
- AC-005 E2E 测试

**关联需求**

- ER-002、ER-003、NFR-002、AC-005

### T5.2 敏感信息脱敏

**前置条件**

- 日志和报告写入前经过脱敏层

**输入 / 输出**

- 输入：命令输出、Diff、报告
- 输出：脱敏后的日志和报告

**成功标准**

```gherkin
Given 输出包含访问令牌、密码、私钥
When 写入本地存储
Then 敏感信息被替换为占位符
And 任务记录不包含明文凭证
```

**异常场景**

- 未知密钥格式
- 脱敏规则误伤正常内容
- 二进制文件内容

**测试证据**

- 脱敏规则单元测试

**关联需求**

- NFR-001、NFR-006

### T5.3 日志容量与清理

**前置条件**

- Artifact 和 AgentEvent 存储已可用

**输入 / 输出**

- 输入：日志和产物
- 输出：容量统计、清理结果

**成功标准**

```gherkin
Given 单个任务日志超过 100 MB
When 触发压缩
Then 保留错误、审批、验证和最近事件
Given 总数据达到 5 GB 的 80%
When 用户查看
Then 系统提醒清理
And 不自动删除任务
```

**异常场景**

- 清理正在使用的日志
- 磁盘写满
- 用户未二次确认

**测试证据**

- 容量统计测试
- 日志轮转测试

**关联需求**

- NFR-006

### T5.4 测试策略

**前置条件**

- 所有业务模块已实现

**输入 / 输出**

- 输入：测试代码
- 输出：单元、集成、契约、E2E 测试结果

**成功标准**

```gherkin
Given 完整测试套件
When 执行测试
Then 核心状态机和策略单元测试通过
And App Server 契约测试通过
And Worktree/Validation 集成测试通过
And Web UI E2E 测试通过
```

**异常场景**

- 测试不稳定
- 测试依赖外部网络
- 协议 fixture 过期

**测试证据**

- CI 测试报告

**关联需求**

- NFR-003

### T5.5 性能检查

**前置条件**

- Web UI 可用

**输入 / 输出**

- 输入：性能指标
- 输出：冷启动、页面响应、事件延迟、事件容量

**成功标准**

```gherkin
Given V1 目标
When 测量
Then 冷启动不超过 5 秒
And 普通操作响应不超过 300 毫秒
And Agent 事件展示延迟不超过 1 秒
And 单任务事件分页或至少保留最近 10000 条
```

**异常场景**

- 大仓库首次加载
- 大量 Agent 事件并发到达

**测试证据**

- 性能测试报告

**关联需求**

- NFR-004

### T5.6 AC-001 ~ AC-005 完整验收

**前置条件**

- M1-M5 全部功能可用

**输入 / 输出**

- 输入：真实或 fixture Git 仓库
- 输出：AC-001 至 AC-005 验收结果

**成功标准**

```gherkin
Given 需求中的端到端场景
When 逐一执行
Then AC-001 正常修复通过
And AC-002 计划退回通过
And AC-003 高风险操作通过
And AC-004 验证失败通过
And AC-005 应用异常退出通过
```

**异常场景**

- 场景依赖缺失
- 验收证据不完整

**测试证据**

- 验收测试报告和运行日志

**关联需求**

- AC-001 ~ AC-005

---

## 9. 需求映射

| 需求 | 负责里程碑 |
|---|---|
| FR-001 本地项目管理 | M1、M4 |
| FR-002 任务创建 | M1、M4 |
| FR-003 任务契约生成 | M0、M1、M2 |
| FR-004 Git Worktree 隔离 | M0、M1、M3 |
| FR-005 项目规范与验证命令 | M1、M3 |
| FR-006 Codex Runtime | M0、M2 |
| FR-007 根因与修复计划确认 | M0、M2、M4 |
| FR-008 风险分级审批 | M0、M3、M4 |
| FR-009 代码变更展示 | M0、M3、M4 |
| FR-010 验证执行与证据 | M3、M4、M5 |
| FR-011 交付报告 | M0、M3、M4 |
| FR-012 最终验收 | M2、M4 |
| FR-013 任务记录与审计 | M1、M3、M5 |
| ER-001 ~ ER-005 | M0、M1、M3、M5 |
| NFR-001 ~ NFR-006 | 全阶段 |

---

## 10. 当前状态

- M0 的 V1-V5 协议验证已全部通过
- `protocol-spike` 已具备可复用的 App Server 客户端和审批策略模块
- 下一步进入 M1，从 T1.1 开始
