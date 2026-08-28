# Bugfix Harness V1

面向单个工程师、本地运行的 Bugfix 控制平面。它把自然语言 Bug 描述转换为结构化任务，在隔离 Git Worktree 中驱动 Codex 完成分析、修复和验证，并输出可审计的 Diff、验证证据和交付报告。

## 核心能力

- 管理本地 Git 项目
- 创建结构化 Bugfix 任务和任务契约
- 自动创建隔离 Git Worktree
- 通过 `codex-harness app-server --stdio` 驱动 Codex Runtime
- 分析/实施阶段的计划确认门
- 命令和文件变更的风险分级审批
- 统一 Diff 展示
- 执行项目声明的验证命令并保存证据
- 生成结构化交付报告
- 最终验收、退回、拒绝和取消
- 任务、审批、事件和产物的本地审计

## 技术栈

- 前端：React、TypeScript、Vite、React Router、Zustand
- 后端：Node.js、TypeScript、Fastify、WebSocket
- 数据库：SQLite
- Agent Runtime：`codex-harness app-server`
- 测试：Vitest、Playwright

## 仓库结构

```text
apps/
  server/                 # 本地控制平面、API、Runtime 适配
  web/                    # Web UI
packages/
  shared/                 # 领域模型、zod schema、状态机、计划 Prompt
  codex-protocol/         # Codex app-server 生成协议
protocol-spike/           # App Server 协议验证脚本
e2e/                      # Playwright 前后端验证
docs/                     # 需求、开发计划、验收计划、验收报告
```

## 环境要求

- Node.js 24+
- pnpm 11+
- Git 2.23+
- Codex Runtime：`codex-harness`

## 安装

```bash
pnpm install
pnpm e2e:install
```

## 启动

使用统一脚本一次启动/停止/重启前后端服务（同时支持 macOS/Linux 和 Windows）：

```bash
# macOS / Linux
./scripts/services.sh start
./scripts/services.sh stop
./scripts/services.sh restart
./scripts/services.sh status

# 也可通过 pnpm 调用（macOS / Linux / Windows 均可用）
pnpm services:start
pnpm services:stop
pnpm services:restart
pnpm services:status
```

Windows 可直接运行：

```bat
scripts\services.cmd start
scripts\services.cmd stop
scripts\services.cmd restart
scripts\services.cmd status
```

脚本默认同时管理前后端，也可以用 `server` 或 `web` 只操作单个服务：

```bash
./scripts/services.sh restart server
./scripts/services.sh status web
```

日志输出到 `.run/logs/server.log` 和 `.run/logs/web.log`。

如需分别在前台运行，仍可使用：

后端：

```bash
pnpm dev:server
```

前端：

```bash
pnpm dev:web
```

默认地址：

- 前端：http://127.0.0.1:4318
- 后端：http://127.0.0.1:4317
- 后端健康检查：http://127.0.0.1:4317/api/health

## 常用脚本

```bash
pnpm build                 # 构建全部包
pnpm typecheck             # 全量类型检查
pnpm test                  # 全量单元/集成测试
pnpm e2e                   # Playwright 前后端验证
pnpm accept:e2e            # 真实 Codex 端到端验收
pnpm accept:unit           # 验收单测
pnpm accept:crash          # 崩溃/进程树恢复验证
```

## 协议验证

```bash
cd protocol-spike
npm run validate
```

该命令验证：

- `outputSchema` 结构化输出
- 单 Thread 多 Turn 与中断
- Git Worktree、`cwd`、Diff
- Thread 记录恢复
- 审批风险矩阵

## 配置

后端环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BUGFIX_HARNESS_HOME` | `~/.bugfix-harness` | 数据、数据库和 Worktree 根目录 |
| `BUGFIX_HARNESS_PORT` | `4317` | 后端端口 |
| `BUGFIX_HARNESS_HOST` | `127.0.0.1` | 后端监听地址 |
| `CODEX_BIN` | `codex-harness` | Codex Runtime 命令 |

## 验收

完整验收计划见：

- [docs/acceptance-plan.md](docs/acceptance-plan.md)

验收报告见：

- [docs/acceptance-report.md](docs/acceptance-report.md)

## 安全边界

- 分析阶段使用 read-only 沙箱
- 实施阶段使用 workspace-write 沙箱
- 默认拒绝 Worktree 外写入
- 永久禁止 Git Commit、Push、Merge Request
- 日志和报告写入前进行敏感信息脱敏
- 验证命令以参数数组执行，避免 shell 字符串拼接

## License

Apache-2.0
