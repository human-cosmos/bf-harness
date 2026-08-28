# Bugfix Harness 代码问题修复实施方案

本方案基于 2026-08-28 对 `bugfix-harness` 项目手写代码的 code review 结果编写。审查范围包含
`apps/server`、`apps/web`、`packages/shared`、`packages/codex-protocol`（仅手写入口/生成脚本）、
`scripts`、`e2e`；不包含 vendor 进来的 `codex-harness/` 上游仓库与 `packages/codex-protocol/src/generated/**`
生成代码。

## 现状基线

- `pnpm typecheck`：4 个包全部通过。
- `@bugfix-harness/server` 单测：18 个文件 / 43 个用例通过。
- `@bugfix-harness/web` 单测：2 个文件 / 6 个用例通过。

## 问题与修复总览

| 编号 | 优先级 | 问题 | 涉及模块 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | P1 | 审批列表摘要/详情 method 不匹配，UI 显示 fallback | server/web | 已修复 |
| 2 | P1 | 文件写审批策略失效，`allowedPaths` 未生效，`grantRoot` 当作文件路径 | server | 已修复 |
| 3 | P1 | 删除含任务的项目外键失败、无清理 | server | 已修复 |
| 4 | P1 | 路径范围校验前后端不一致、相对路径解析错误 | shared/web/server | 已修复 |
| 5 | P2 | 命令只读白名单过宽，`sed -i`/`find -delete`/越界读取被自动放行 | server | 已修复 |
| 6 | P2 | 验证命令输出无流式上限，可能先吃满内存 | server | 已修复 |
| 7 | P2 | `agent_events.seq` 非任务内唯一，事件保留清理不可靠 | server | 已修复 |
| 8 | P2 | 后台任务/验证服务端无并发保护 | server | 已修复 |
| 9 | P2 | RPC 无超时、进程退出不 reject、spawn 失败报错不友好 | server | 已修复 |
| 10 | P2 | 取消/退出时未决澄清与审批 Promise 不清理 | server | 已修复 |
| 11 | P3 | 交付报告验收清单对每个条件使用同一布尔值 | server/web/shared | 已修复 |
| 12 | P3 | 脱敏规则覆盖不足 | server | 已修复 |
| 13 | P3 | 旧审批方法未接入策略；权限审批响应形状错误；网络分支死代码 | server | 已修复 |
| 14 | P3 | `/api/tasks/:id/events` 参数 NaN 未校验 | server | 已修复 |
| 15 | P3 | `protocol-spike` Node 版本声明与根不一致 | protocol-spike | 已修复 |

---

## 问题 1：审批列表摘要/详情 method 不匹配

### 问题描述

实施阶段通过 `ExecutionService.requestApprovalDecision` 落库的审批记录，`method` 字段保存的是
`item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 等完整 JSON-RPC 方法名；
而前端 `approvalSummary` / `approvalDetails` 按 `"command"` / `"file"` / `"network"` / `"permissions"`
判断。二者永远不相等，导致审批列表里所有记录都走 fallback 文案“AI 发起了一个操作请求”，技术详情也只显示原始 JSON。
用户在“批准/拒绝”安全敏感操作时看不到实际命令或文件路径。

### 修复方案

- 统一 `ApprovalRequestRepository` 的 `method` 语义为稳定的 `kind`：
  `command` / `file` / `network` / `permissions`。
- 修改 `ExecutionService.requestApprovalDecision` 落库时的 `method` 取值，从完整方法名改为 `request.kind`，
  与 `recordApproval` 保持一致。
- 原始 JSON-RPC 方法名已经由 `agent_events` 的运行时事件完整保留，不损失审计信息。

### 验收标准

1. 新增/修改单元测试：对 command/file/network/permissions 四类请求，`requestApprovalDecision` 落库后的
   `method` 分别为 `command` / `file` / `network` / `permissions`。
2. 前端 `approvalSummary`/`approvalDetails` 对四类 method 均能返回具体文案而非 fallback。
3. 全量 `pnpm typecheck` 通过；server/web 单测通过。

---

## 问题 2：文件写审批策略失效，`allowedPaths` 未生效

### 问题描述

`classifyFile` 只检查 `forbiddenPaths` 和 `plannedPaths`，从未使用 `context.allowedPaths`。
同时 `FileChangeRequestApprovalParams` 协议没有具体文件路径，只有 `grantRoot`（“允许在此根下写入”），
`AgentOrchestrator` 用 `grantRoot` 当文件路径做 `plannedPaths` 的精确相等匹配，导致“计划内文件改动自动放行”几乎不可能命中。

### 修复方案

- 在 `PolicyContext` 增加可选 `repoRoot`，用于把“相对仓库根 / 绝对仓库路径”的配置映射到 worktree 绝对路径。
- 让 `makePolicyContext` 统一解析：
  - `worktreeRoot`：解析为绝对路径。
  - `allowedPaths` / `forbiddenPaths` / `plannedPaths`：相对路径按 worktree 根解析；
    绝对路径若位于 `repoRoot` 下，则映射为 worktree 下的对应路径。
- 重写 `classifyFile` 的写分支：
  - 非绝对路径或不在 worktree 内 → deny。
  - 命中 forbidden → deny。
  - 命中 allowed（target 位于某 allowed root 内）→ autoAllow。
  - 命中 planned（target 位于某 planned 文件或其父目录内）→ autoAllow。
  - 否则 → prompt。
- `ExecutionService` 构造 `makePolicyContext` 时传入 `repoRoot: project.repoPath`。

### 验收标准

1. 新增单元测试覆盖：
   - 计划内文件写 autoAllow。
   - allowedPaths 内但未在 planned 中的写 autoAllow。
   - 越界/forbidden 写 deny。
   - 相对 allowedPaths/forbiddenPaths 按 worktree 根正确解析。
2. 现有 `approval-policy.test.ts` 与 `acceptance.test.ts` 继续通过。
3. 全量 typecheck / 单测通过。

---

## 问题 3：删除含任务的项目失败且无清理

### 问题描述

`DELETE /api/projects/:id` 直接调用 `ProjectRepository.delete`，只执行单条 `DELETE FROM projects`。
数据库开启 `foreign_keys = ON`，项目下有任务时因外键约束抛错返回 500，路由也没有 try/catch；
同时物理 worktree 与子记录都不会清理。前端删除确认文案却声称“其下所有任务也会被删除”。

### 修复方案

- 在 `BugfixService` 增加 `deleteProject(projectId)`：
  1. 读取项目，不存在则抛 `Project not found`。
  2. 遍历该项目全部任务：中断 runtime、清理澄清/分析状态，物理删除 worktree（失败仅告警）。
  3. 逐任务调用 `TaskRepository.delete`（已级联删除该任务的全部子记录）。
  4. 删除项目记录，发布 `project.deleted` 事件。
- `app.ts` 路由改为调用 `service.deleteProject`，并区分 404/400。

### 验收标准

1. 新增集成测试：创建项目 + 任务 + worktree 记录后删除项目，断言项目、任务、worktree 记录均不存在且不抛外键错误。
2. 删除不存在项目返回 404。
3. 全量 typecheck / 单测通过。

---

## 问题 4：路径范围校验前后端不一致、相对路径解析错误

### 问题描述

`projectSchema` 要求 `instructionSources/allowedPaths/forbiddenPaths` 为绝对路径，但
`createProjectInputSchema` 又覆盖为普通 `z.string()`，导致校验不一致。前端默认值是 `src/`、`test/`、
`node_modules/` 等相对路径，服务端 `resolve()` 相对进程 cwd 解析，落到 bugfix-harness 自己目录，
范围控制对目标 worktree 完全失效。

### 修复方案

- 明确这些字段的语义：允许绝对路径，也允许“相对仓库根”的路径。
- `projectSchema` / `createProjectInputSchema` 统一使用 `z.array(z.string().min(1)).default([])`。
- 配合问题 2 的 `makePolicyContext` 解析逻辑，将相对路径按 worktree 根映射。
- 更新前端表单提示文案，说明相对路径是相对仓库根目录。

### 验收标准

1. `createProjectInputSchema` 接受相对路径（如 `src/`）与绝对路径；拒绝空字符串。
2. 前端默认配置与提示文案自洽。
3. 相对 forbiddenPaths（如 `node_modules/`）能命中 worktree 下对应路径（由问题 2 的测试覆盖）。

---

## 问题 5：命令只读白名单过宽

### 问题描述

`classifyCommand` 把 `rg|grep|find|ls|cat|sed|head|tail` 无条件 `autoAllow`，且发生在 `isInside(cwd)` 之前。
`sed -i` 会原地写文件，`find -delete` 会删除文件，`cat /etc/passwd` 等越界读取也会自动放行。

### 修复方案

- 将“只读命令自动放行”的前提收紧为：`cwd` 位于 worktree 内，且命令参数不包含 worktree 外的绝对路径。
- 对 `sed` 排除 `-i`/`--in-place`，对 `find` 排除 `-delete`/`-exec`/`-execdir`；命中破坏性形态则回落为 prompt。
- 保留 git 历史/状态类只读命令的自动放行，但同样要求 cwd 在 worktree 内且无越界绝对路径参数。

### 验收标准

1. 新增单元测试：`git status`（cwd 在 worktree）autoAllow；`sed -i ...`、`find -delete`、
   `cat /etc/passwd` 均不为 autoAllow（prompt 或 deny）；越界 cwd 的只读命令 deny。
2. 现有审批策略测试继续通过。

---

## 问题 6：验证命令输出无流式上限

### 问题描述

`ValidationRunner.run` 在 `data` 事件里 `stdout += chunk.toString()` 无限累积，`truncateOutput` 只在
进程结束时才截断。持续刷屏的命令会在结束前耗尽内存。

### 修复方案

- 引入有界输出缓冲器，在追加阶段即截断到 `MAX_OUTPUT_BYTES`，只保留一次截断标记。
- stdout/stderr 各自独立限流。

### 验收标准

1. 新增单元测试：运行输出超过上限的命令，断言 `stdout` 长度不超过上限 + 截断标记长度，且包含截断提示。
2. 现有 `validation-runner.test.ts` 继续通过。

---

## 问题 7：`agent_events.seq` 非任务内唯一

### 问题描述

每个 `RuntimeEventRecorder` 实例从 0 开始自增 `seq`，同一任务的 analyze/implement/问计划会各自开 runtime，
造成任务内 `seq` 重复；`pruneToRecent` 依赖“seq 唯一且越大越新”，重复时会误删/漏删。

### 修复方案

- 将 `seq` 的生成职责从 recorder 移到 `AgentEventRepository.append`：
  每次插入时在任务内计算 `MAX(seq)+1`，保证任务内单调唯一（同步 SQLite 调用，单进程内原子）。
- 从 `AgentEventInput` 和 `RuntimeEventRecorder` 移除外部传入的 `seq`。
- 更新相关测试。

### 验收标准

1. 新增/修改单元测试：同任务插入多条事件，`seq` 为 1..N 连续且唯一；跨任务互不影响。
2. `pruneToRecent` 保留的是按 `seq` 排序的最新 N 条。
3. 现有 `retention-executor.test.ts` 调整后通过。

---

## 问题 8：后台任务/验证服务端无并发保护

### 问题描述

`startImplementJob` / `startContinueFixJob` / `startValidationJob` / `startReportJob` 服务端不检查
是否已有同类运行中任务；implement 结束后还会自动 `void runValidations()`，与手动 `/validate` 可并行，
产生重复验证结果与重复状态迁移。

### 修复方案

- `BugfixService.startBackgroundJob` 增加“同任务同类运行中”检查，冲突时抛错；任务结束/失败后释放占用。
- `ExecutionService.runValidations` 增加任务级去重：同任务已有运行中验证时返回同一个 Promise，避免重复执行。

### 验收标准

1. 新增单元测试：连续启动两个同任务同类 job，第二个抛错；验证并发调用只产生一份结果。
2. 全量 typecheck / 单测通过。

---

## 问题 9：RPC 无超时、进程退出不 reject、spawn 失败不友好

### 问题描述

`AppServerRuntime.rpc` 只挂 `pending`，不设超时；app-server 退出时未决 RPC 不会 reject；spawn ENOENT 时
`child.stdout` 可能为 null，`createInterface` 会抛内部 TypeError。

### 修复方案

- `rpc` 增加默认超时（复用 `options.timeoutMs`），超时或 `send` 失败时 reject。
- `start()` 监听 child `error`/`exit`，退出或启动失败时 reject 全部未决 RPC。
- 保存 `spawnError`，`send`/`waitForTurnCompletion` 检查并给出明确错误。
- 仅当 `child.stdout` 存在时建立 readline，避免启动失败时抛 TypeError。

### 验收标准

1. 新增单元测试（或可测的 smoke）：spawn 不存在的二进制后，`initialize()` 快速 reject 且错误信息可读。
2. 现有 runtime 相关测试/typecheck 通过。

---

## 问题 10：取消/退出时未决澄清与审批 Promise 不清理

### 问题描述

`ClarificationCoordinator.clear` 只删 map 不 resolve；`ExecutionService.approvalWaiters` 在取消或进程
退出时也不清理，导致 `request`/`requestApprovalDecision` 的 Promise 永久 pending，反复取消会累积泄漏。

### 修复方案

- `ClarificationCoordinator.clear` 对被清理条目 resolve 空答案。
- `ExecutionService` 记录 waiter 所属 task，新增 `cancelApprovals(taskId)`，在取消/删除任务时 resolve 为 `cancel`。
- `BugfixService.cancelTask` / `deleteTask` 调用 `cancelApprovals`。

### 验收标准

1. 新增单元测试：pending 审批在 `cancelApprovals` 后 resolve 为 `cancel`；澄清 `clear` 后 pending promise resolve。
2. 全量 typecheck / 单测通过。

---

## 问题 11：交付报告验收清单失真

### 问题描述

`DeliveryReportService.build` 对所有 acceptance criterion 使用同一个 `satisfied` 布尔值（取决于是否有任一
验证失败），不能反映单项是否满足。

### 修复方案

- `DeliveryReport` 移除逐条 `satisfied` 的误导字段，`acceptanceChecklist` 改为 `{ criterion: string }[]`。
- 新增顶层 `validationPassed: boolean`，由验证结果统一计算。
- 前端 ReportPage 将“结果清单”改为“验收条件（请逐项人工确认）”，逐项展示验收条件，
  自动检查状态由独立的“自动检查”字段表达。

### 验收标准

1. 修改 `report-and-retry.test.ts` 断言 `validationPassed` 计算正确，`acceptanceChecklist` 为条件列表。
2. 前端 ReportPage 类型与渲染一致，typecheck 通过。

---

## 问题 12：脱敏规则覆盖不足

### 问题描述

password 规则要求值紧跟 `:`/`=` 且不含空格/引号，`password: "my secret"`、`export AWS_SECRET_ACCESS_KEY=...`
等常见形式不覆盖。

### 修复方案

- 扩充 `redaction.ts` 规则：支持带空格/引号的 password 值，新增 AWS Secret Access Key、通用
  secret/token/credential 等规则，并保证规则顺序由具体到通用。

### 验收标准

1. 新增单元测试：`password: "my secret"`、`AWS_SECRET_ACCESS_KEY=...` 等样本被脱敏。
2. 现有 `redaction-retention.test.ts` 继续通过。

---

## 问题 13：旧审批方法未接入策略、权限响应形状错误、网络分支死代码

### 问题描述

`ServerRequest` 仍含 `applyPatchApproval` / `execCommandApproval` 旧方法，但 orchestrator 未处理，
`approvalMode="decline"` 会让它们被自动拒绝；`item/permissions/requestApproval` 的 v2 响应应为
`{ permissions, scope }`，当前却返回 `{ decision }`；`item/network/requestApproval` 在该协议版本不存在，属死代码。

### 修复方案

- 在 `implement` 的 `onServerRequest` 中：
  - 处理 `execCommandApproval`：从 `command[]` + `cwd` 构造 command 审批，返回
    `{ decision: accept -> "approved" / decline -> { denied: { rejection } } / cancel -> "abort" }`。
  - 处理 `applyPatchApproval`：从 `grantRoot` 构造 file 审批，返回同样的 `ReviewDecision` 形状。
  - 修正 `item/permissions/requestApproval`：批准时回传请求的 `permissions`，拒绝/取消回传空权限，`scope: "turn"`。
  - 删除 `item/network/requestApproval` 死分支。
- 将旧方法响应映射集中为辅助函数，避免分支内重复。

### 验收标准

1. 新增单元测试覆盖响应映射辅助函数（approve/decline/cancel 三种结果、permissions 授权/拒绝）。
2. 全量 typecheck / 单测通过。

---

## 问题 14：`/api/tasks/:id/events` 参数未校验

### 问题描述

`limit`/`afterSeq` 用 `Number()` 转换，NaN 会直接传入 SQL；无效输入应返回 400 而不是继续查询。

### 修复方案

- 解析并校验 `limit`（正整数，上限 1000）与 `afterSeq`（非负整数），非法时返回 400。

### 验收标准

1. 新增测试：非法 `limit`/`afterSeq` 返回 400。
2. 全量 typecheck / 单测通过。

---

## 问题 15：`protocol-spike` Node 版本声明不一致

### 问题描述

根 `package.json` 要求 Node >=24，`protocol-spike/package.json` 声明 >=22。

### 修复方案

- 将 `protocol-spike/package.json` 的 `engines.node` 改为 `>=24`。

### 验收标准

1. 文件内容与根声明一致。

---

## 实施与验收记录

| 编号 | 验收结果 | 证据 |
| --- | --- | --- |
| 1 | 已验收 | `execution-approval.test.ts` 断言 `method === "command"`，通过 |
| 2 | 已验收 | `approval-policy.test.ts` 新增 allowedPaths/相对路径/仓库绝对路径映射用例，通过 |
| 3 | 已验收 | `bugfix-service.test.ts` 删除含任务项目无外键错误，通过 |
| 4 | 已验收 | `packages/shared/test/schemas.test.ts` 相对路径接受/空值拒绝用例，通过 |
| 5 | 已验收 | `approval-policy.test.ts` sed -i/find -delete/越界读取/越界 cwd 用例，通过 |
| 6 | 已验收 | `validation-runner.test.ts` 超大输出流式截断用例，通过 |
| 7 | 已验收 | `retention-executor.test.ts` seq 自动生成唯一用例，通过 |
| 8 | 已验收 | `bugfix-service.test.ts` 同类 job 拒绝 + `validation-dedupe.test.ts` 去重用例，通过 |
| 9 | 已验收 | `app-server-runtime.test.ts` 二进制不可 spawn 时快速 reject 用例，通过 |
| 10 | 已验收 | `execution-approval.test.ts` cancelApprovals + `clarification-coordinator.test.ts` clear 用例，通过 |
| 11 | 已验收 | `report-and-retry.test.ts` validationPassed/acceptanceChecklist 形状用例，通过 |
| 12 | 已验收 | `redaction-retention.test.ts` 密码带空格/AWS Secret Access Key 用例，通过 |
| 13 | 已验收 | `approval-response.test.ts` v2/权限/旧方法响应映射用例，通过 |
| 14 | 已验收 | `app-events.test.ts` 非法分页参数返回 400 用例，通过 |
| 15 | 已验收 | `protocol-spike/package.json` 已改为 `>=24` |
