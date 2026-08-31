# Bugfix Harness 使用说明

本文档面向使用者，说明如何在本机安装、启动和操作 Bugfix Harness。

Bugfix Harness 是一个面向单个工程师、本地运行的 Bugfix 控制平面：它把自然语言的 Bug 描述转换成结构化任务，在隔离的 Git Worktree 中驱动 Codex 完成分析、修复和验证，最后产出可审计的 Diff、验证证据和交付报告。

## 1. 能力概览

- 管理本地或远程 Git 项目
- 创建结构化 Bugfix 任务与任务契约
- 自动创建隔离 Git Worktree
- 通过 `codex-harness app-server --stdio` 驱动 Codex Runtime
- 分析/实施阶段的计划确认门
- 命令、文件变更与网络的风险分级审批
- 统一 Diff 展示
- 执行项目声明的验证命令并保存证据
- 生成结构化交付报告，支持最终验收、退回、拒绝和取消
- 项目级自由对话（Arbitrary Codex Chat）
- 任务、审批、事件和产物的本地审计

## 2. 环境要求

- Node.js 24+
- pnpm 11+
- Git 2.23+
- Codex Runtime：`codex-harness`（本机可用 `codex-harness --version` 验证）

## 3. 安装

```bash
pnpm install
pnpm e2e:install
```

第二条命令安装 Playwright 的 Chromium，只有需要跑 `pnpm e2e` 时才需要。

## 4. 启动与停止服务

### 4.1 统一脚本（后台运行，推荐）

macOS / Linux：

```bash
./scripts/services.sh start      # 启动前后端
./scripts/services.sh stop       # 停止前后端
./scripts/services.sh restart    # 重启前后端
./scripts/services.sh status     # 查看状态
```

Windows：

```bat
scripts\services.cmd start
scripts\services.cmd stop
scripts\services.cmd restart
scripts\services.cmd status
```

也可以统一走 pnpm（三种系统通用）：

```bash
pnpm services:start
pnpm services:stop
pnpm services:restart
pnpm services:status
```

默认同时管理前后端。只操作单个服务时，在命令末尾加 `server` 或 `web`：

```bash
./scripts/services.sh restart server   # 只重启后端
./scripts/services.sh stop web         # 只停止前端
./scripts/services.sh status web       # 只看前端状态
```

脚本会把进程 PID 写到 `.run/server.pid`、`.run/web.pid`，日志写到 `.run/logs/server.log`、`.run/logs/web.log`。

### 4.2 前台开发模式

后端：

```bash
pnpm dev:server
```

前端：

```bash
pnpm dev:web
```

前台模式直接在终端里 `Ctrl+C` 停止。

### 4.3 默认地址

- 前端：http://127.0.0.1:4318
- 后端：http://127.0.0.1:4317
- 后端健康检查：http://127.0.0.1:4317/api/health

健康检查返回 `{"ok":true}` 即后端正常。

## 5. 快速上手

下面是一次完整的 Bugfix 主链路。

### 5.1 打开界面

启动服务后，浏览器访问 http://127.0.0.1:4318。

### 5.2 添加项目

在「项目」页面点击新建项目。系统支持两种来源：

- **本地仓库**：填写仓库的绝对路径（必须是本地 Git 仓库）。
- **远程仓库**：填写 Git 远程地址（GitHub/GitLab），可选账号与 Token。系统会异步克隆到本地并管理。

同时可以配置项目的默认约束：

- 指令来源（默认 `AGENTS.md`）
- 验证命令（例如 `npm test`、`npm run typecheck`）
- 允许修改路径（例如 `src/`、`test/`）
- 禁止修改路径（例如 `node_modules/`）

这些约束会写入任务契约，驱动后续的修复过程。

### 5.3 创建 Bugfix 任务

进入项目后新建任务，填写：

- Bug 描述（必填）
- 观察到的行为、期望行为
- 复现步骤 / 复现命令
- 相关日志、相关文件
- 验收标准、约束

创建后任务处于 `DRAFT`（待开始）状态。

### 5.4 走完修复工作流

工作流分为五个阶段：

1. **分析**：系统在隔离 Worktree 中以只读沙箱驱动 Codex 分析问题。
2. **计划确认**：Codex 输出修复计划，等待你确认。你可以批准、批准并实施，或退回重做，也可以追问。
3. **实施**：Codex 在 workspace-write 沙箱中修改代码。涉及命令、文件变更、网络等高风险操作时，会暂停等待你审批。
4. **验证**：运行项目声明的验证命令并保存证据。
5. **验收**：查看 Diff 和交付报告，选择通过、退回再改、不采用或取消。

对应任务状态：`DRAFT → PREPARING_WORKSPACE → ANALYZING → WAITING_FOR_PLAN_APPROVAL → IMPLEMENTING → VALIDATING → WAITING_FOR_ACCEPTANCE → ACCEPTED`。

过程中有需要你处理的事项时，可以在「待办中心」查看聚合的待办和审批。

### 5.5 项目自由对话

在项目下还可以发起开放式、多轮的 Codex 自由对话，类似 codex-cli 的交互体验，同时保留日志、思考过程、工具调用、输出流、审批与审计。

自由对话默认遵循当前安全边界（workspace-write、按需审批）；只有在「完整 CLI 等价模式」显式开启时，才允许完整访问、网络与 Git 写操作。

## 6. 页面导航

| 页面 | 路由 | 说明 |
|---|---|---|
| 项目列表 | `/` | 项目卡片、搜索、状态、删除 |
| 待办中心 | `/pending` | 待处理任务与审批聚合 |
| 新建项目 | `/projects/new` | 本地 / 远程项目表单 |
| 项目详情 | `/projects/:id` | 项目信息与任务列表 |
| 项目对话列表 | `/projects/:id/chat` | 项目自由对话列表 |
| 新建任务 | `/tasks/new` | 任务契约生成 |
| 任务详情 | `/tasks/:id` | 状态、工作流步骤、实时事件、日志 |
| 修复计划 | `/tasks/:id/plan` | 计划确认与追问 |
| 操作审批 | `/tasks/:id/approvals` | 审批列表与决定 |
| 变更与检查 | `/tasks/:id/diff` | Diff 展示、验证运行、继续修复 |
| 验收报告 | `/tasks/:id/report` | 生成报告、验收 |
| 运行日志 | `/tasks/:id/logs` | 任务运行日志 |
| 系统设置 | `/settings` | 设置、提示词模板、磁盘诊断、Runtime |

## 7. 任务状态

| 状态 | 含义 |
|---|---|
| `DRAFT` | 待开始 |
| `PREPARING_WORKSPACE` | 准备仓库中 |
| `ANALYZING` | 分析中 |
| `WAITING_FOR_PLAN_APPROVAL` | 待你确认计划 |
| `IMPLEMENTING` | 待实施 |
| `VALIDATING` | 验证中 |
| `WAITING_FOR_ACCEPTANCE` | 待你验收 |
| `ACCEPTED` | 已验收 |
| `BLOCKED` | 受阻 |
| `FAILED` | 失败 |
| `CANCELLED` | 已取消 |
| `REJECTED` | 已拒绝 |

## 8. 操作审批

审批按风险分级，分析阶段默认只读沙箱，实施阶段默认 workspace-write 沙箱。以下操作会进入审批：

- 命令执行
- 文件写入 / 变更（默认拒绝 Worktree 外写入）
- 网络访问
- 权限提升

审批请求会在任务审批页和待办中心出现，你可以逐条批准/拒绝，也可以批量拒绝。系统永久禁止 Git Commit、Push、Merge Request。

## 9. 系统设置

在「系统设置」页面可以配置：

- Agent 超时与审批 TTL
- Bugfix / 自由对话的模型与推理强度
- 安全默认策略与审批评审人
- 项目默认约束
- 存储上限、日志上限、自动修复轮次
- 远程克隆超时
- Codex Runtime 可执行文件
- 提示词模板

## 10. 配置参考（环境变量）

后端通过环境变量配置，默认值如下：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BUGFIX_HARNESS_HOME` | `~/.bugfix-harness` | 数据、数据库和 Worktree 根目录 |
| `BUGFIX_HARNESS_PORT` | `4317` | 后端端口 |
| `BUGFIX_HARNESS_HOST` | `127.0.0.1` | 后端监听地址 |
| `BUGFIX_HARNESS_ANALYSIS_TIMEOUT_MS` | `600000` | 分析阶段无活动后的空闲超时 |
| `BUGFIX_HARNESS_IMPLEMENTATION_TIMEOUT_MS` | `600000` | 实施阶段无活动后的空闲超时 |
| `BUGFIX_HARNESS_ANALYSIS_MAX_DURATION_MS` | 空 | 分析阶段累计活跃时长硬上限 |
| `BUGFIX_HARNESS_IMPLEMENTATION_MAX_DURATION_MS` | 空 | 实施阶段累计活跃时长硬上限 |
| `BUGFIX_HARNESS_CONVERSATION_TIMEOUT_MS` | `600000` | 自由对话无活动后的空闲超时 |
| `BUGFIX_HARNESS_APPROVAL_TTL_MS` | 空 | 自由对话审批/澄清等待 TTL |
| `CODEX_BIN` | `codex-harness` | Codex Runtime 命令 |

## 11. 数据与日志位置

- 数据库：`~/.bugfix-harness/data.sqlite`
- 远程仓库：`~/.bugfix-harness/repos/`
- Worktree：`~/.bugfix-harness/worktrees/`
- 服务日志：`.run/logs/server.log`、`.run/logs/web.log`
- 任务运行日志：在任务详情的「运行日志」页面查看

## 12. 安全边界

- 分析阶段使用 read-only 沙箱
- 实施阶段使用 workspace-write 沙箱
- 默认拒绝 Worktree 外写入
- 永久禁止 Git Commit、Push、Merge Request
- 日志和报告写入前进行敏感信息脱敏
- 验证命令以参数数组执行，避免 shell 字符串拼接

## 13. 常用脚本

```bash
pnpm build                 # 构建全部包
pnpm typecheck             # 全量类型检查
pnpm test                  # 全量单元/集成测试
pnpm e2e                   # Playwright 前后端验证
pnpm accept:e2e            # 真实 Codex 端到端验收
pnpm accept:unit           # 验收单测
pnpm accept:crash          # 崩溃/进程树恢复验证
```

## 14. 常见问题

**前端能打开但看不到数据？**

先确认后端健康检查返回正常：`curl http://127.0.0.1:4317/api/health`，应返回 `{"ok":true}`。

**服务状态异常或端口被占用？**

查看状态与日志：

```bash
pnpm services:status
tail -f .run/logs/server.log
```

必要时先停止再重启：`pnpm services:restart`。

**提示找不到 codex-harness？**

确认 `codex-harness --version` 可用；否则通过 `CODEX_BIN` 环境变量指定完整路径，或在「系统设置 → Runtime」里配置。

**任务一直停在等待审批？**

前往「待办中心」或任务审批页处理对应的审批请求。
