# Bugfix Harness V1 全页面端到端验证报告

## 2026-09-01 Windows 全量复验（E2E-01–19 / AC-001–005）

执行时间：2026-09-01  
范围：基线 + 全页面矩阵 + 隔离 Playwright + 真实验收脚本 + 重启恢复。

### 环境

- Windows 11 x64，Node.js v24.13.0，pnpm 11.22.0，Git 2.52.0.windows.1
- Codex Runtime：官方 `codex-cli 0.142.2`（PATH 上的 `codex`/`codex.cmd` 解析到 native `codex.exe`）
- 前端：http://127.0.0.1:4318 ；后端：http://127.0.0.1:4317

### 基线与自动检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 通过 |
| 单元/集成测试 | `pnpm test` | 通过（server 155 / web 35 / shared 36 / protocol 1） |
| 协议验证 V1–V5 | `cd protocol-spike && npm run validate` | 全部 PASS（修复后复验） |
| 全页面 UI 冒烟 | `pnpm exec playwright test --config=e2e-live/live.config.ts` | 13 个场景通过 |
| Playwright E2E | `pnpm e2e` | 9 个场景通过（含 `full-ai-flow` 约 1.1 分钟） |
| 真实 API 主链路 | `pnpm accept:e2e` | `E2E_ACCEPTANCE_OK`，最终 `ACCEPTED` |
| 真实对话端到端 | `pnpm accept:conversation` | `CONVERSATION_E2E_OK` |
| 验收单测 AC-002/003/004/005 | `pnpm accept:unit` | 4 个测试通过 |
| 崩溃/进程树 | `pnpm accept:crash` | `CRASH_RECOVERY_OK` |
| 重启恢复 | `pnpm services:restart` + API/页面抽查 | `E2E-19_OK` |

### 逐项验证结果

| 编号 | 页面/能力 | 结果 | 说明 |
|---|---|---|---|
| E2E-01 | 基础与导航 | 通过 | e2e-live |
| E2E-02 | 项目列表 `/` | 通过 | e2e-live |
| E2E-03 | 添加本地项目 | 通过 | e2e-live |
| E2E-04 | 添加远程项目 | 通过 | e2e-live |
| E2E-05 | 项目任务 | 通过 | e2e-live |
| E2E-06 | 待办中心 | 通过 | e2e-live + 重启后页面 200 |
| E2E-07 | 新建任务 | 通过 | e2e-live |
| E2E-08 | 任务详情 | 通过 | e2e-live |
| E2E-09 | 修复计划 | 通过 | 隔离 Playwright 真实 AI 主链路 |
| E2E-10 | 操作审批 | 通过 | AC-003 单测 + 审批策略 |
| E2E-11 | 变更与检查 | 通过 | 真实 AI 主链路 |
| E2E-12 | 验收报告 | 通过 | 真实 AI 主链路 |
| E2E-13 | 运行日志 | 通过 | e2e-live |
| E2E-14 | 系统设置 | 通过 | e2e-live |
| E2E-15 | 自由对话列表 | 通过 | e2e-live |
| E2E-16 | 自由对话详情 | 通过 | e2e-live 策略面板；真实发送经 `accept:conversation` |
| E2E-17 | 错误状态 | 通过 | e2e-live |
| E2E-18 | 真实 AI 主链路 | 通过 | API 与 Playwright UI 均到 `ACCEPTED` |
| E2E-19 | 重启恢复 | 通过 | 项目/任务/对话仍在；任务保持 `DRAFT` 未自动续跑；仅 4317/4318 监听 |

### 本次发现的 BUG 与修复

| # | 级别 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| 11 | Blocker | `protocol-spike` `npm run validate` 立刻退出，未完成握手 | 默认只找 `codex-harness`，Windows 上只有官方 `codex`；子进程失败后 RPC 悬挂 | spike 解析 `CODEX_BIN` / PATH 上的 `codex`，展开 npm `codex.exe`，启动失败立即 reject |
| 12 | Blocker | V3 worktree 校验失败，清理报 `EPERM` | OS 临时目录是 `ADMINI~1` 短路径，Codex 沙箱拒绝；进程未退净 | scratch 改到仓库 `.tmp-e2e` 并 `realpathSync.native`；清理加重试 |
| 13 | Major | V4 重启恢复：`thread/turns/list` 要 `experimentalApi`；`thread/items/list` 未知；`thread/turns/items/list` 返回 not supported | 官方 Codex 0.142.2 握手与 items API 与旧 `codex-harness` 不一致 | initialize 声明 `experimentalApi`；items 优先新方法，失败则从 `thread/read?includeTurns` 回填 |
| 14 | Major | 产品对话历史同步在官方 Codex 上会同样失败 | `AppServerRuntime.listItems` 仍调用 `thread/items/list` | 先试 `thread/turns/items/list`，再回退旧方法；不可用时 `ConversationService` 从 `thread/read` 取 items |
| 15 | Test | V5「计划内写文件」在 Windows 上得到 `prompt` | spike 策略用未 normalize 的 `/tmp/...` 和 `resolve` 后的盘符路径做精确比较 | 对齐主应用：`resolve` 目标路径，用 `isInside` 判断 allowed/planned |
| 16 | Major | `pnpm services:status` 显示已停止，但 4317 仍被占用；Vite 曾漂到 4320 | 只认 PID 文件；Vite 未 `strictPort` | `scripts/services.mjs` 按端口探测/清理/健康检查；Vite `strictPort: true` |
| 17 | Major | `pnpm accept:crash` 报 `spawn codex-harness ENOENT`，修好后又 `thread/start` 5s 超时 | 脚本写死 `codex-harness`；官方 Codex 握手更慢 | `AppServerRuntime` 默认走 `resolveAvailableCodexBin()`；崩溃脚本超时改为 30s |

### Minor

- 没有 `GET /api/projects/:id`（Fastify 返回 404）。重启验证改用 `GET /api/projects` 列表 + `GET /api/tasks/:id` + `GET /api/conversations/:id`，不阻塞。
- 现场库里留下探测项目 `E2E-19 Restart Probe`（任务保持 `DRAFT`），可从 UI 删除。
- 隔离 Playwright 过程中 Vite 有 `ws proxy socket error: ECONNABORTED`，测试仍通过，属页面关闭时的代理噪声。

### 全量结论

E2E-01–E2E-19 与 AC-001–AC-005 在 Windows + 官方 Codex 0.142.2 上通过。上述 Blocker/Major 已修复并复验。

---

## 2026-09-01 Windows 主流程复验（E2E-18 / AC-001）

执行时间：2026-09-01  
范围：仅主流程（创建任务 → 分析 → 计划批准 → 实施 → 验证 → 报告 → 验收），不重复全页面矩阵。

### 环境

- Windows 11 x64，Node.js v24.13.0，pnpm 11.22.0，Git 2.52.0.windows.1
- Codex Runtime：官方 `codex-cli 0.142.2`（由 PATH 上的 `codex`/`codex.cmd` 解析到 native `codex.exe`）
- 前端：http://127.0.0.1:4318 ；后端：http://127.0.0.1:4317

### 基线

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 通过 |
| 单元/集成测试 | `pnpm test` | 通过（server 155 / web 35 / shared 36 / protocol 1） |
| 真实 API 主链路 | `pnpm accept:e2e` | `E2E_ACCEPTANCE_OK`，最终 `ACCEPTED` |
| Playwright UI 主链路 | `pnpm exec playwright test e2e/full-ai-flow.spec.ts` | 通过（约 1.5 分钟） |

浏览器走通：在运行中的 Web UI 完成「添加项目页渲染 + 新建任务并进入任务详情」。现场 `~/.bugfix-harness/data.sqlite` 缺 `prompt_templates` 表，导致该库上的分析立刻 `FAILED`；重启后迁移修复会自动补表。完整 UI 主链路由隔离环境的 Playwright 覆盖。

### 本次发现的 BUG 与修复

| # | 级别 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| 7 | Blocker | Windows 上 `pnpm test` 失败：`echo` 验证、shebang 假二进制、`Source: /` 断言 | Windows 无独立 `echo` 可执行文件；`spawn` 不能跑 Unix shebang；绝对路径不是 `/` 开头 | 验证命令改为 `node -e`；Runtime 探测支持 `.cmd`/`.bat` 与官方 npm `codex.exe`；测试按平台写脚本；路径断言改为真实绝对路径 |
| 8 | Major | 验证超时后临时目录 `EPERM`，子进程残留 | `ValidationRunner` 用 `SIGKILL`，Windows 杀不掉进程树 | 改为 `terminateChildTree`（`taskkill /T /F`） |
| 9 | Blocker | `accept:e2e` 分析失败：8.3 短路径下 Windows 沙箱拒绝访问 worktree；计划 JSON 前带散文或字段形状不对 | `realpathSync` 不展开 `ADMINI~1`；官方 Codex 未严格遵守 `outputSchema` | `realpathSync.native` 展开长路径；从混合输出提取 JSON；`coerceRepairPlan` 兼容别名/对象命令/字符串 evidence，并把绝对路径收成仓库相对路径 |
| 10 | Major | 现场库分析报 `no such table: prompt_templates` | `schema_migrations` 已记 version 3，但表不存在 | `migrate()` 结束后 `CREATE TABLE IF NOT EXISTS prompt_templates` |

### 主流程结论

E2E-18 / AC-001 在 Windows + 官方 Codex 0.142.2 上通过：API 与 Playwright UI 均到达 `ACCEPTED`。上述缺陷已修复并复验。

---

执行时间：2026-08-30

## 1. 环境

- Node.js v24.18.0、pnpm 11.22.0、Git 2.50.1
- Codex Runtime：`codex-harness`（`/Users/zed-mac/.cargo/bin/codex-harness`，`codex-cli 0.0.0`）
- 前端：http://127.0.0.1:4318 ；后端：http://127.0.0.1:4317

## 2. 自动检查基线

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm -r typecheck` | 通过 |
| 单元/集成测试 | `pnpm -r test` | 通过（server 135 / web 19 / shared 33 / protocol 1） |
| 协议验证 V1-V5 | `cd protocol-spike && npm run validate` | 全部 PASS |
| Playwright E2E | `pnpm e2e` | 9 个场景通过（full-flow / conversation-flow / full-ai-flow） |
| 真实端到端 | `pnpm --filter @bugfix-harness/server accept:e2e` | `E2E_ACCEPTANCE_OK`，最终 `ACCEPTED` |
| 真实对话端到端 | `pnpm --filter @bugfix-harness/server accept:conversation` | `CONVERSATION_E2E_OK` |
| 验收单测 AC-002/003/004/005 | `pnpm --filter @bugfix-harness/server accept:unit` | 4 个测试通过 |
| 崩溃/进程树 | `pnpm --filter @bugfix-harness/server accept:crash` | `CRASH_RECOVERY_OK` |
| 全页面 UI 冒烟 | `npx playwright test --config=e2e-live/live.config.ts` | 13 个场景通过 |

## 3. 逐项验证结果

| 编号 | 页面/能力 | 结果 | 说明 |
|---|---|---|---|
| E2E-01 | 基础与导航 | 通过 | 修复前端绑定地址问题 |
| E2E-02 | 项目列表 `/` | 通过 | 修复删除含对话项目报错 |
| E2E-03 | 添加本地项目 | 通过 | 后端校验生效；记录 Minor 项 |
| E2E-04 | 添加远程项目 | 通过 | 表单与原生必填校验 |
| E2E-05 | 项目任务 | 通过 | 任务列表与筛选 |
| E2E-06 | 待办中心 | 通过 | 空态与聚合逻辑 |
| E2E-07 | 新建任务 | 通过 | 必填校验与契约生成 |
| E2E-08 | 任务详情 | 通过 | 状态、删除、事件 |
| E2E-09 | 修复计划 | 通过 | 由真实 AI 主链路覆盖 |
| E2E-10 | 操作审批 | 通过 | 由 AC-003 单测与审批策略覆盖 |
| E2E-11 | 变更与检查 | 通过 | 由真实 AI 主链路覆盖 |
| E2E-12 | 验收报告 | 通过 | 由真实 AI 主链路覆盖 |
| E2E-13 | 运行日志 | 通过 | 页面可访问 |
| E2E-14 | 系统设置 | 通过 | 各组与诊断渲染 |
| E2E-15 | 自由对话列表 | 通过 | 列表/新建/空态 |
| E2E-16 | 自由对话详情 | 通过 | 输入框/策略；真实对话经 accept:conversation |
| E2E-17 | 错误状态 | 通过 | 404 与未知任务 |
| E2E-18 | 真实 AI 主链路 | 通过 | 修复分析阶段卡死 |
| E2E-19 | 重启恢复 | 通过 | 项目/任务/对话重启后仍存在 |

## 4. 发现的 BUG 与修复

| # | 级别 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| 1 | Blocker | `pnpm services:start` 后 README 声明的前端地址 127.0.0.1:4318 不可达，仅 localhost 可达 | Vite 默认只绑定 IPv6 `::1` | `apps/web/vite.config.ts` 增加 `server.host: "127.0.0.1"` |
| 2 | Blocker | 删除包含自由对话的项目报 `FOREIGN KEY constraint failed` | `deleteProject` 未级联删除 conversations 及其子表 | `bugfix-service.deleteProject` 先删除项目下全部 conversations |
| 3 | Blocker | 真实 AI 主链路分析阶段一直停在 `ANALYZING`，turn 不结束 | `startTurn` 传入 `planMode: true`，当前 codex-harness 下 plan 协作模式不发出 `turn/completed` | 移除 `planMode`，依赖 read-only 沙箱 + `outputSchema` + decline 审批保证分析只读 |
| 4 | Major | `/prepare-worktree` 返回 `CREATING` 而非 `READY` | 新记录创建后只改了库表状态，返回的仍是旧对象 | 更新后重新读取 worktree 再返回 |
| 5 | Test | `e2e/full-flow`、`e2e/full-ai-flow` 选择器失效 | 新建任务表单重构后按钮文案与 label 歧义 | 修正为 `问题描述` 精确匹配与 `创建任务` 按钮名 |
| 6 | Test | `accept:e2e` 报 `Invalid task transition: VALIDATING -> VALIDATING` | `implement()` 与 `runValidations()` 已自动迁移状态，脚本仍冗余迁移 | 移除冗余的 `transitionTask` 调用 |

## 5. Minor 项处理

- 手动输入非 Git 仓库路径后保存，前端原本展示后端原始 `git rev-parse` 报错。已修复：`GitWorktreeManager.validateRepository` 现在统一抛出友好文案“该目录不是 Git 仓库，请选择包含 .git 的仓库根目录。”，并通过 `POST /api/projects` 返回给前端展示。

## 6. 结论

全部页面功能端到端验证通过；发现的 Blocker/Major 缺陷均已修复并复验通过，Minor 项也已修复，无遗留问题。
