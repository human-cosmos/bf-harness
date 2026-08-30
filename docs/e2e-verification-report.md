# Bugfix Harness V1 全页面端到端验证报告

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
