# Bugfix Harness V1 完整验收计划

## 1. 验收目标与范围

验收目标是确认系统满足 `bugfix-harness-v1.md` 的 `APPROVED` 基线，并且所有 `[CONFIRMED]` 需求和端到端场景都能稳定复现。

验收范围：

- 功能需求 FR-001 ~ FR-013
- 异常与恢复需求 ER-001 ~ ER-005
- 非功能需求 NFR-001 ~ NFR-006
- 端到端验收场景 AC-001 ~ AC-005
- Codex App Server 协议验证 V1 ~ V5

验收不包含：

- Git Commit、Push、Merge Request 或生产系统操作
- 多 Agent 编排、远程调度、账号团队权限
- 自动部署和云同步

## 2. 验收环境与前置条件

### 2.1 目标环境

- Windows 11，建议同时覆盖 x64 和 arm64
- Node.js 24+
- pnpm 11+
- Git 2.23+
- 可用的 Codex Runtime：`codex-harness app-server --stdio`
- 至少一个本地 Git 测试仓库

### 2.2 测试数据

准备 3 类 fixture 仓库：

1. `fixtures/node-bug`：包含一个可稳定复现的失败测试
2. `fixtures/go-bug`：包含 lint/build 验证命令
3. `fixtures/mixed`：包含禁止路径、计划外文件和依赖安装风险

### 2.3 环境检查

```bash
node --version
pnpm --version
git --version
codex-harness --version
pnpm -r typecheck
pnpm -r test
```

## 3. 自动验收流程

### 3.1 全量静态检查

```bash
pnpm -r typecheck
```

通过标准：所有 workspace 无 TypeScript 错误。

### 3.2 全量单元/集成测试

```bash
pnpm -r test
```

通过标准：

- server 全部测试通过
- shared 全部测试通过
- codex-protocol 全部测试通过
- web 全部测试通过

### 3.3 协议验证

```bash
cd protocol-spike
npm run validate
```

通过标准：V1-V5 全部输出 `PASS`。

### 3.4 真实端到端验收

```bash
pnpm --filter @bugfix-harness/server accept:e2e
```

通过标准：

- 输出 `E2E_ACCEPTANCE_OK`
- 验证状态为 `passed`
- 最终任务状态为 `ACCEPTED`

### 3.5 崩溃与进程树验收

```bash
pnpm --filter @bugfix-harness/server accept:crash
```

通过标准：输出 `CRASH_RECOVERY_OK`。

## 4. 功能验收矩阵

| 需求 | 验收方法 | 通过标准 | 证据 |
|---|---|---|---|
| FR-001 项目管理 | 手工 + 自动 | 项目增删查成功，重启后仍存在 | 项目页截图、数据库记录 |
| FR-002 任务创建 | 手工 + 自动 | 必填字段校验，创建后为 DRAFT | 新建任务页、数据库记录 |
| FR-003 任务契约 | 自动 | 生成 1.0 契约，字段完整 | `task_contracts` 记录 |
| FR-004 Worktree 隔离 | 自动 | Agent 只改 Worktree，主仓库干净 | Git status、Worktree 路径 |
| FR-005 项目规范与验证命令 | 手工 + 自动 | 项目配置可声明验证命令，不静默覆盖仓库约束 | 项目配置、执行日志 |
| FR-006 Codex Runtime | 自动 | 可启动/停止，保存 Thread/Turn | Runtime smoke、`agent_sessions` |
| FR-007 计划确认 | 自动 + 手工 | 批准前禁止实施，退回回分析 | AC-002、状态机测试 |
| FR-008 风险审批 | 自动 + 手工 | autoAllow/prompt/deny 正确 | 审批策略测试、审批记录 |
| FR-009 Diff 展示 | 自动 + 手工 | 文件状态、Diff、计划外提示 | Diff 接口、页面截图 |
| FR-010 验证证据 | 自动 | 命令、cwd、退出码、输出均记录 | `validation_results` |
| FR-011 交付报告 | 自动 + 手工 | 报告关联 Diff 和验证结果 | `delivery_reports` |
| FR-012 最终验收 | 手工 + 自动 | 接受/退回/拒绝/取消状态正确 | 状态机测试、页面操作 |
| FR-013 审计 | 自动 + 手工 | 任务、审批、事件、产物可追溯 | SQLite、事件分页接口 |

## 5. 手动验收流程

### 5.1 项目管理

1. 打开项目列表
2. 添加有效 Git 仓库
3. 验证不修改原仓库
4. 重启服务
5. 确认项目仍存在
6. 删除项目并确认

### 5.2 正常修复 AC-001

1. 选择 fixture 仓库
2. 创建 Bugfix 任务
3. 准备 Worktree
4. 启动分析
5. 检查根因、证据、修改范围
6. 批准计划
7. 启动实施
8. 检查 Diff
9. 运行验证
10. 生成报告
11. 最终验收
12. 确认主仓库无变化

### 5.3 计划退回 AC-002

1. 进入计划确认页
2. 填写退回意见
3. 退回计划
4. 确认任务回到 ANALYZING
5. 确认未产生代码修改
6. 确认旧计划和退回记录仍可审计

### 5.4 高风险操作 AC-003

1. 让 Agent 请求安装依赖、删除文件或访问网络
2. 在审批页查看命令、原因、影响范围
3. 批准或拒绝
4. 确认决定被记录

### 5.5 验证失败 AC-004

1. 使用会失败的验证命令
2. 运行验证
3. 确认保存失败证据
4. 确认自动修复最多 2 轮
5. 确认第 2 次同失败后进入 BLOCKED

### 5.6 应用异常退出 AC-005

1. 启动任务
2. 强制退出本地服务
3. 重启服务
4. 确认未完成任务仍显示
5. 确认没有孤儿 Agent 进程
6. 确认不自动续跑原 Thread
7. 基于原任务新建 Session 重试

## 6. 安全验收

### 6.1 路径与沙箱

- Agent 不得写 Worktree 外路径
- 分析阶段必须 read-only
- 实施阶段 workspace-write
- 永久拒绝 Git Commit/Push/MR

### 6.2 敏感信息

测试数据中放入：

- Bearer token
- API key
- password
- 私钥
- AWS Access Key

验证写入日志、审批、验证结果、报告前已脱敏。

### 6.3 IPC 与命令执行

- 前端不能直接访问 Node.js
- 所有输入通过 zod 校验
- 命令以参数数组执行，不使用字符串拼接
- 未知审批请求默认拒绝

## 7. 可靠性与恢复验收

- 状态迁移原子保存
- 重复点击不创建重复 Runtime
- 应用异常退出不破坏任务记录
- Worktree 创建失败不落回主工作区
- Agent 异常退出保存失败记录
- 重试不覆盖原失败记录
- SQLite migration 可升级、可回滚/重入

## 8. 性能验收

测量项与目标：

| 指标 | 目标 | 方法 |
|---|---|---|
| 冷启动 | ≤ 5 秒 | 计时脚本 |
| 普通页面操作 | ≤ 300 ms | DevTools / Playwright |
| Agent 事件展示延迟 | ≤ 1 秒 | 事件时间戳差值 |
| 单任务事件容量 | ≥ 10,000 条或分页 | 批量写入后查询 |

## 9. 数据保留与清理验收

- 单任务日志上限 100 MB
- 总数据上限 5 GB
- 达到 80% 时提醒
- 不自动删除任务
- 清理前需要二次确认
- 默认保留 Worktree，只允许工程师手动清理

## 10. UI/UX 验收

页面清单：

- 项目列表/项目配置
- 新建 Bugfix 任务
- 任务运行详情
- 计划确认
- 操作审批
- Diff 与验证结果
- 最终验收/交付报告
- 基础设置与 Runtime 诊断

检查项：

- 页面可访问，错误状态可理解
- 审批队列及时更新
- 长时间运行事件流不卡顿
- 移动窗口尺寸下基本可用
- 敏感信息不以明文展示

## 11. 发布验收

- `pnpm -r build` 成功
- Web 产物可静态部署或本地预览
- 本地后端可独立启动
- 进程退出后无残留监听端口
- 安装文档和运行命令可复现

## 12. 缺陷处理与验收结论

缺陷分级：

| 级别 | 是否阻塞发布 |
|---|---|
| Blocker | 是 |
| Critical | 是 |
| Major | 需评估 |
| Minor | 否，记录后续修复 |

验收退出标准：

1. 自动验收全绿
2. AC-001 ~ AC-005 手动场景全通过
3. 无 Blocker/Critical 缺陷
4. 所有 Major 缺陷有明确处理结论
5. 验收报告归档并签字

## 13. 验收报告模板

```text
项目：Bugfix Harness V1
版本：
验收日期：
环境：

自动验收结果：
- typecheck: pass/fail
- test: pass/fail
- protocol spike: pass/fail
- e2e: pass/fail
- crash: pass/fail

手动场景：
- AC-001:
- AC-002:
- AC-003:
- AC-004:
- AC-005:

缺陷统计：
- Blocker:
- Critical:
- Major:
- Minor:

验收结论：
- [ ] 通过
- [ ] 有条件通过
- [ ] 不通过

签字：
```
