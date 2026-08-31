# Bugfix Harness 桌面端 Windows 打包方案

状态：方案文档，供 Windows 平台继续开发

目标：把当前 `bugfix-harness` 仓库打包成一个可安装的 Windows 桌面应用，安装后不要求用户预装 Node、Codex、Git，使用 API key 登录 Codex，并从当前 `codex-harness` 源码构建随包分发的 Codex 二进制。

## 1. 结论

可行，但需要把构建拆成两段：

1. **Windows Codex 二进制构建**：必须在 Windows runner / Windows VM 上执行。
2. **Electron 安装包构建**：在 Windows 上执行，最终产出 NSIS 安装包。

当前 macOS 只能做应用层、后端、前端和方案落地，不能可靠地交叉编译 Windows MSVC 版本的 Codex。

## 2. 现有项目关键约束

- 前端是 React + Vite，开发时由 Vite 代理 `/api` 到后端，见 [vite.config.ts](/Users/zed-mac/Documents/projects/bugfix-harness/apps/web/vite.config.ts)。
- 后端是 Fastify + WebSocket，使用 Node 24 内置 `node:sqlite`，见 [db.ts](/Users/zed-mac/Documents/projects/bugfix-harness/apps/server/src/db.ts)。
- 后端通过 `spawn(codexBin, ["app-server", "--stdio"])` 驱动 Codex，见 [app-server-runtime.ts](/Users/zed-mac/Documents/projects/bugfix-harness/apps/server/src/services/app-server-runtime.ts)。
- Codex 检测顺序是：系统设置 > `CODEX_BIN` > fallback > 本地 debug 构建 > PATH，见 [codex-runtime-service.ts](/Users/zed-mac/Documents/projects/bugfix-harness/apps/server/src/services/codex-runtime-service.ts)。
- `codex-harness/` 当前是 gitignore 的本地克隆，不是可复现依赖。
- 后端目前不托管静态文件，也没有 SIGTERM/SIGINT 优雅关闭。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────┐
│                  Electron BrowserWindow             │
│          加载 http://127.0.0.1:<dynamic-port>       │
└───────────────────────┬────────────────────────────┘
                        │
                        │ Electron main 只负责：
                        │ 1. 启动 Node sidecar
                        │ 2. API key 登录
                        │ 3. 窗口生命周期
                        ▼
┌────────────────────────────────────────────────────┐
│             Node 24 sidecar（打包内置）              │
│               server/index.mjs                      │
│               Fastify + WebSocket + static web       │
└──────┬─────────────────────────────┬────────────────┘
       │ /api                         │ spawn
       ▼                             ▼
   React SPA                  codex.exe app-server --stdio
                              （随包分发的固定版本）
```

选择 Electron + Node sidecar 而不是 Tauri，原因是后端强依赖 Node 24、`node:sqlite`、`child_process` 和 Codex stdio 协议，直接用现有 Node 后端最省成本。

## 4. 运行时依赖处理

| 依赖 | 当前来源 | Windows 安装包处理 |
|---|---|---|
| Node 24+ | 用户系统 | 打包 `node.exe` sidecar |
| `node:sqlite` | Node 内置 | 由 Node 24 sidecar 提供 |
| Codex app-server | 用户 PATH / 本地 debug | 从固定 commit 构建 `codex.exe` |
| Windows sandbox | Codex 内部 | 同时打包两个 helper exe |
| `CODEX_HOME` / 登录态 | 用户 `~/.codex` | 独立目录 + API key 写入 `auth.json` |
| Git | 用户系统 | 打包 MinGit，或首次启动检测并提示 |
| 前端 | Vite dev | 构建后由 Fastify 静态托管 |
| Codex 协议类型 | 由本地 codex 生成 | 用打包的 `codex.exe` 同版本重新生成 |

## 5. Codex 环境处理

### 5.1 固定源码版本

当前本地 `codex-harness` 检出为：

```text
2764e83626efe55f64e04d153fc99a157327f3c2
```

建议把该 commit 写入 `CODEX_REVISION` 或 submodule，构建流程只允许从该 commit 出二进制。

获取源码：

```powershell
$CODEX_REVISION = "2764e83626efe55f64e04d153fc99a157327f3c2"
git clone https://github.com/openai/codex.git codex-harness
git -C codex-harness checkout $CODEX_REVISION
```

### 5.2 Windows 下构建 Codex 二进制

前置条件：

- Windows 10/11 x64
- Visual Studio 2022 Build Tools，勾选 C++ workload
- Rust stable `1.95.0`
- `rustup target add x86_64-pc-windows-msvc`

构建命令：

```powershell
cd codex-harness\codex-rs
$env:LIBSQLITE3_FLAGS = "SQLITE_DISABLE_INTRINSIC"

cargo build --target x86_64-pc-windows-msvc --release `
  --bin codex `
  --bin codex-windows-sandbox-setup `
  --bin codex-command-runner
```

产物位置：

```text
codex-harness/codex-rs/target/x86_64-pc-windows-msvc/release/
  codex.exe
  codex-windows-sandbox-setup.exe
  codex-command-runner.exe
```

这三个文件必须一起放入安装包。`codex.exe` 会在相邻目录或 `codex-resources/` 下查找 sandbox helper。

官方已有完整 Windows release workflow，可作为参考：

- [rust-release-windows.yml](/Users/zed-mac/Documents/projects/bugfix-harness/codex-harness/.github/workflows/rust-release-windows.yml)

### 5.3 用同版本二进制重新生成协议

协议类型当前由 `codex-harness app-server generate-ts` 生成，生成脚本见 [generate.mjs](/Users/zed-mac/Documents/projects/bugfix-harness/packages/codex-protocol/generate.mjs)。

在 Windows 上构建完 `codex.exe` 后执行：

```powershell
$env:CODEX_BIN = "C:\path\to\codex.exe"
node packages\codex-protocol\generate.mjs
```

确保协议类型和最终随包分发的二进制来自同一个 commit。

### 5.4 `CODEX_BIN` 注入

桌面壳启动 Node sidecar 前设置：

```ts
process.env.CODEX_BIN = path.join(
  process.resourcesPath,
  "codex",
  "codex.exe",
);
```

这样现有 [CodexRuntimeService](/Users/zed-mac/Documents/projects/bugfix-harness/apps/server/src/services/codex-runtime-service.ts) 的 `CODEX_BIN` 分支会直接命中，不需要改动核心检测逻辑。

### 5.5 `CODEX_HOME` 独立目录

Codex 的 `CODEX_HOME` 如果被设置，必须已存在且是目录，见 [home-dir/src/lib.rs](/Users/zed-mac/Documents/projects/bugfix-harness/codex-harness/codex-rs/utils/home-dir/src/lib.rs)。

桌面端建议：

```text
%APPDATA%\BugfixHarness\codex-home\
  auth.json
  config.toml      # 可选
```

启动前必须创建目录：

```ts
const codexHome = path.join(app.getPath("userData"), "codex-home");
fs.mkdirSync(codexHome, { recursive: true });
```

### 5.6 API key 登录

不使用 ChatGPT 登录。使用 Codex 自带的 API key 登录：

```powershell
codex.exe login --with-api-key
```

它从 stdin 读取 key，最终写入 `CODEX_HOME/auth.json`：

```json
{
  "auth_mode": "ApiKey",
  "OPENAI_API_KEY": "<key>"
}
```

对应实现见 [login.rs](/Users/zed-mac/Documents/projects/bugfix-harness/codex-harness/codex-rs/cli/src/login.rs) 和 [manager.rs](/Users/zed-mac/Documents/projects/bugfix-harness/codex-harness/codex-rs/login/src/auth/manager.rs)。

app-server 启动时通过 `AuthManager::shared_from_config(..., enable_codex_api_key_env=false)` 读 `auth.json`，不会依赖 `OPENAI_API_KEY` 环境变量，见 [app-server/src/lib.rs](/Users/zed-mac/Documents/projects/bugfix-harness/codex-harness/codex-rs/app-server/src/lib.rs)。

Electron main 中静默登录示例：

```ts
function loginWithApiKey(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexExe, ["login", "--with-api-key"], {
      env: { ...process.env, CODEX_HOME: codexHome },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.end(`${apiKey.trim()}\n`);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex login exited with ${code}`));
      }
    });
  });
}
```

API key 只通过 stdin 传入，不写入日志，不放入进程参数。

### 5.7 Windows sandbox 与 UAC

项目使用 `read-only` 和 `workspace-write` 沙箱。Windows 下第一次运行可能需要 `codex-windows-sandbox-setup.exe` 提权安装 WFP/firewall 规则，触发 UAC。

对应逻辑见 [setup.rs](/Users/zed-mac/Documents/projects/bugfix-harness/codex-harness/codex-rs/windows-sandbox-rs/src/setup.rs)。

推荐：

- 安装器使用 `perMachine`，安装时完成 sandbox provisioning。
- 或在首次创建任务前，显式提示用户将弹出 UAC。
- 不要默认把策略降级为 `danger-full-access`。

## 6. 后端打包方案

### 6.1 后端 bundle 验证结论

- 使用 esbuild 把 `apps/server/src/index.ts` 打包成 `index.mjs` 可行。
- `@bugfix-harness/shared` 可以直接打进 bundle。
- `fastify`、`@fastify/websocket`、`zod` 必须保持 external，不能全量 bundle，否则 Fastify/avvio 的 dynamic require 会在运行时失败。
- 生产依赖使用 `pnpm deploy --legacy` 生成自包含 `node_modules`。

### 6.2 后端构建脚本

建议新增 `apps/server/build-desktop.mjs`：

```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist-desktop/index.mjs",
  sourcemap: true,
  external: ["fastify", "@fastify/websocket", "zod"],
});
```

生成生产依赖：

```powershell
pnpm --filter @bugfix-harness/server deploy --prod --legacy dist-desktop
```

最终后端资源目录：

```text
dist-desktop/
  index.mjs
  node_modules/
  web/                 # 从 apps/web/dist 复制
```

### 6.3 后端需要新增静态托管和优雅关闭

当前 [index.ts](/Users/zed-mac/Documents/projects/bugfix-harness/apps/server/src/index.ts) 只 `listen`，没有：

- 静态文件服务。
- SPA fallback。
- `SIGTERM` / `SIGINT` 处理。
- 关闭所有 `AppServerRuntime` / `ConversationRuntimeManager`。

桌面版需要补齐。

生产模式下建议新增环境变量：

```text
BUGFIX_HARNESS_WEB_ROOT
```

当该变量存在时，注册 `@fastify/static` 并提供 SPA fallback；开发模式不设置，继续用 Vite。

## 7. Electron 桌面壳

新增 `apps/desktop`：

```text
apps/desktop/
  package.json
  electron-builder.yml
  src/
    main.ts
    preload.ts
  build/
    icon.ico
```

### 7.1 main.ts 骨架

```ts
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

let serverProc: ChildProcess | null = null;
let serverPort = 0;

const resourcesRoot = app.isPackaged
  ? process.resourcesPath
  : path.join(process.cwd(), "..", "..");

const nodeBin = path.join(resourcesRoot, "node", "node.exe");
const serverEntry = path.join(resourcesRoot, "server", "index.mjs");
const codexExe = path.join(resourcesRoot, "codex", "codex.exe");
const codexHome = path.join(app.getPath("userData"), "codex-home");
const harnessHome = path.join(app.getPath("userData"), "harness");

fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(harnessHome, { recursive: true });

async function startServer(): Promise<void> {
  serverPort = await getFreePort();

  serverProc = spawn(nodeBin, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      BUGFIX_HARNESS_HOME: harnessHome,
      BUGFIX_HARNESS_HOST: "127.0.0.1",
      BUGFIX_HARNESS_PORT: String(serverPort),
      BUGFIX_HARNESS_WEB_ROOT: path.join(resourcesRoot, "server", "web"),
      CODEX_BIN: codexExe,
      CODEX_HOME: codexHome,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await waitForHealth(`http://127.0.0.1:${serverPort}/api/health`);
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Bugfix Harness",
    backgroundColor: "#f4f5f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL(`http://127.0.0.1:${serverPort}`);
}

app.whenReady().then(async () => {
  await startServer();
  await createWindow();
});

app.on("before-quit", () => {
  if (serverProc?.pid) {
    serverProc.kill("SIGTERM");
  }
});
```

### 7.2 preload 暴露最小 API

只暴露：

- `selectFolder` / `selectFile`
- `setApiKey`
- `getRuntimeStatus`

保持 `contextIsolation: true`、`nodeIntegration: false`。

## 8. 安装包目录结构

最终 NSIS 安装后：

```text
%LOCALAPPDATA%\Programs\BugfixHarness\
  BugfixHarness.exe
  resources\
    app.asar
    node\
      node.exe
    server\
      index.mjs
      node_modules\
      web\
    codex\
      codex.exe
      codex-windows-sandbox-setup.exe
      codex-command-runner.exe
    git\
      cmd\git.exe
      mingw64\
```

## 9. electron-builder 配置示例

```yaml
appId: com.example.bugfix-harness
productName: Bugfix Harness

directories:
  output: release

files:
  - apps/desktop/dist/**/*

extraResources:
  - from: build/node/
    to: node/
  - from: build/server/
    to: server/
  - from: build/codex/
    to: codex/
  - from: build/git/
    to: git/

win:
  target:
    - nsis
  icon: apps/desktop/build/icon.ico

nsis:
  oneClick: false
  perMachine: true
  allowToChangeInstallationDirectory: true
```

## 10. 环境变量总表

| 变量 | 由谁设置 | 说明 |
|---|---|---|
| `BUGFIX_HARNESS_HOME` | Electron main | 数据目录，建议 `userData/harness` |
| `BUGFIX_HARNESS_HOST` | Electron main | `127.0.0.1` |
| `BUGFIX_HARNESS_PORT` | Electron main | 动态端口，避免 4317 冲突 |
| `BUGFIX_HARNESS_WEB_ROOT` | Electron main | 静态前端目录 |
| `CODEX_BIN` | Electron main | 随包分发的 `codex.exe` |
| `CODEX_HOME` | Electron main | 独立 Codex 目录，存放 `auth.json` |
| `PATH` | Electron main | 前置 MinGit `cmd` 和 Codex 目录 |

## 11. Windows 完整构建流程

```powershell
# 1. 获取固定 commit 的 Codex 源码
git clone https://github.com/openai/codex.git codex-harness
git -C codex-harness checkout $CODEX_REVISION

# 2. 安装依赖
pnpm install

# 3. 构建 Codex Windows 二进制
cd codex-harness\codex-rs
$env:LIBSQLITE3_FLAGS = "SQLITE_DISABLE_INTRINSIC"
cargo build --target x86_64-pc-windows-msvc --release `
  --bin codex `
  --bin codex-windows-sandbox-setup `
  --bin codex-command-runner
cd ..\..

# 4. 重新生成协议
$env:CODEX_BIN = "codex-harness\codex-rs\target\x86_64-pc-windows-msvc\release\codex.exe"
node packages\codex-protocol\generate.mjs

# 5. 构建后端和前端
pnpm --filter @bugfix-harness/server build:desktop
pnpm --filter @bugfix-harness/web build

# 6. 组装 resources
node scripts\assemble-windows-resources.mjs

# 7. 打包 NSIS
pnpm --filter @bugfix-harness/desktop dist:win
```

## 12. 签名与分发

- `codex.exe`、`codex-windows-sandbox-setup.exe`、`codex-command-runner.exe` 需要代码签名。
- Electron exe 和 NSIS 安装器需要签名。
- 没有签名也能安装，但 SmartScreen 会提示未知发布者。
- 若面向内部使用，优先申请 OV 代码签名证书或 Azure Trusted Signing。

## 13. 验收清单

- [ ] 全新 Windows 机器仅安装 App，不装 Node/Git/Codex，能启动。
- [ ] 首次启动可输入 API key，并生成 `CODEX_HOME/auth.json`。
- [ ] 后端能检测到 `CODEX_BIN` 并显示可用。
- [ ] 创建项目、worktree、分析、审批、实施、验证、报告全流程可用。
- [ ] Windows sandbox 首次运行提示或安装器完成初始化。
- [ ] 退出 App 后无残留 `node.exe`、`codex.exe`、`git.exe` 子进程。
- [ ] 路径含空格、中文目录名时不崩溃。
- [ ] 前端静态托管和刷新 fallback 正常。
- [ ] 协议类型与随包 Codex 二进制版本一致。

## 14. 风险与对策

| 风险 | 对策 |
|---|---|
| Codex 协议漂移 | 固定 commit，二进制和协议同源生成 |
| Windows sandbox UAC | 安装器 perMachine 提前 provisioning，或首次运行明确提示 |
| API key 泄露 | 仅走 stdin，不落日志，进程参数不出现 |
| Fastify bundle 失败 | 保持 fastify/websocket/zod external，使用 `pnpm deploy --legacy` |
| 无 Git 环境 | 打包 MinGit，并前置 PATH |
| 退出残留进程 | Node sidecar 统一收口，后端增加 graceful shutdown |
| 未签名被 SmartScreen 拦截 | 申请签名证书，或内部环境加入信任策略 |

## 15. 分阶段实施

1. 固定 `codex-harness` commit，新增 Windows Codex 构建脚本。
2. 后端增加静态托管、SPA fallback、优雅关闭。
3. 新增 `apps/desktop` Electron 壳和 API key 登录。
4. 新增 esbuild 后端打包和资源组装脚本。
5. 在 Windows runner 上跑通 Codex 构建、协议生成、后端/前端构建。
6. 接入 electron-builder NSIS、签名，产出安装包并做验收清单。
