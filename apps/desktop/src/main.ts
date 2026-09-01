import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

const packagedResourcesRoot = path.join(path.dirname(process.execPath), "resources");
const resourcesRoot = existsSync(
  path.join(packagedResourcesRoot, "node", "node.exe"),
)
  ? packagedResourcesRoot
  : path.resolve(process.cwd(), "build");

const nodeBin = path.join(resourcesRoot, "node", "node.exe");
const serverEntry = path.join(resourcesRoot, "server", "index.cjs");
const webRoot = path.join(resourcesRoot, "server", "web");
const serverNodePath = path.join(resourcesRoot, "server", "vendor", "deps");
const codexExe = path.join(resourcesRoot, "codex", "codex.exe");
const gitCmdDir = path.join(resourcesRoot, "git", "cmd");
const codexDir = path.dirname(codexExe);
const codexHome = path.join(app.getPath("userData"), "codex-home");
const codexAuthFile = path.join(codexHome, "auth.json");
const harnessHome = path.join(app.getPath("userData"), "harness");

mkdirSync(codexHome, { recursive: true });
mkdirSync(harnessHome, { recursive: true });

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a free port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
        reject(
          new Error(
            `Node sidecar exited before becoming healthy (${serverProcess.exitCode})`,
          ),
        );
        return;
      }

      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      request.once("error", retry);
      request.setTimeout(1_000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Timed out waiting for Node sidecar health"));
        return;
      }
      setTimeout(check, 100);
    };

    check();
  });
}

async function startServer(): Promise<void> {
  if (!existsSync(nodeBin)) {
    throw new Error(`Bundled Node executable not found: ${nodeBin}`);
  }
  if (!existsSync(serverEntry)) {
    throw new Error(`Bundled server entry not found: ${serverEntry}`);
  }

  serverPort = await getFreePort();
  serverProcess = spawn(nodeBin, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      BUGFIX_HARNESS_HOME: harnessHome,
      BUGFIX_HARNESS_HOST: "127.0.0.1",
      BUGFIX_HARNESS_PORT: String(serverPort),
      BUGFIX_HARNESS_WEB_ROOT: webRoot,
      CODEX_BIN: codexExe,
      CODEX_HOME: codexHome,
      NODE_PATH: serverNodePath,
      PATH: [gitCmdDir, codexDir, process.env.PATH ?? ""]
        .filter(Boolean)
        .join(path.delimiter),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  serverProcess.once("error", (error) => {
    console.error("Node sidecar failed to start", error);
  });

  await waitForHealth(`http://127.0.0.1:${serverPort}/api/health`);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Bugfix Harness",
    backgroundColor: "#f4f5f1",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#f4f5f1",
      symbolColor: "#24251f",
      height: 40,
    },
    autoHideMenuBar: true,
    backgroundMaterial: "mica",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
}

async function createSplashWindow(): Promise<void> {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f4f5f1;
        color: #24251f;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .box { text-align: center; }
      h1 { margin: 0 0 18px; font-size: 24px; font-weight: 700; }
      .spinner {
        width: 34px;
        height: 34px;
        margin: 0 auto 14px;
        border: 3px solid rgba(36, 37, 31, 0.16);
        border-top-color: #24251f;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      p { margin: 0; font-size: 13px; opacity: 0.68; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>Bugfix Harness</h1>
      <div class="spinner"></div>
      <p>正在启动...</p>
    </div>
  </body>
</html>`;

  splashWindow = new BrowserWindow({
    width: 360,
    height: 260,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: "#f4f5f1",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
}

function loginWithApiKey(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexExe, ["login", "--with-api-key"], {
      env: { ...process.env, CODEX_HOME: codexHome },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.end(`${apiKey.trim()}\n`);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `codex login exited with ${code}`));
      }
    });
  });
}

function applyTitleBarTheme(theme: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const isDark = theme === "dark";
  mainWindow.setTitleBarOverlay({
    color: isDark ? "#121419" : "#f4f5f1",
    symbolColor: isDark ? "#e8eaec" : "#1f2319",
    height: 40,
  });
}

ipcMain.handle("dialog:select-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("dialog:select-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("codex:set-api-key", async (_event, apiKey: unknown) => {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("API key is required");
  }
  await loginWithApiKey(apiKey);
  return { ok: true };
});

ipcMain.handle("codex:get-auth-status", () => ({
  authenticated: existsSync(codexAuthFile),
  authFile: codexAuthFile,
  codexHome,
}));

ipcMain.handle("window:set-theme", (_event, theme: unknown) => {
  if (theme === "light" || theme === "dark") {
    applyTitleBarTheme(theme);
  }
  return { ok: true };
});

ipcMain.handle("runtime:status", () => ({
  serverUrl: `http://127.0.0.1:${serverPort}`,
  codexExe,
  codexHome,
  harnessHome,
}));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createSplashWindow();
  try {
    await startServer();
    await createWindow();
  } finally {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    splashWindow = null;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess?.pid) {
    serverProcess.kill("SIGTERM");
  }
});
