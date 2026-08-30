import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { RemoteCloneProgress } from "@bugfix-harness/shared";
import { redactSensitive } from "./redaction.js";
import type { RemoteSystemSettings } from "@bugfix-harness/shared";

const execFileAsync = promisify(execFile);

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface RemoteRepoInfo {
  host: "github" | "gitlab";
  owner: string;
  repo: string;
  cloneUrl: string;
}

export interface CloneOptions {
  remoteUrl: string;
  username?: string;
  passwordOrToken?: string;
  defaultBranch?: string;
  targetDir: string;
  timeoutMs?: number;
  onProgress?: (progress: RemoteCloneProgress) => void;
}

interface GitRunOptions {
  timeoutMs: number;
  cwd?: string;
  auth?: {
    username?: string;
    passwordOrToken?: string;
  };
}

export class GitRemoteService {
  private readonly lsRemoteTimeoutMs: number;
  private readonly cloneTimeoutMs: number;
  private readonly timeouts?: () => RemoteSystemSettings;

  constructor(
    options: {
      lsRemoteTimeoutMs?: number;
      cloneTimeoutMs?: number;
      timeouts?: () => RemoteSystemSettings;
    } = {},
  ) {
    this.lsRemoteTimeoutMs = options.lsRemoteTimeoutMs ?? 30_000;
    this.cloneTimeoutMs = options.cloneTimeoutMs ?? 600_000;
    this.timeouts = options.timeouts;
  }

  private effectiveTimeouts(): RemoteSystemSettings {
    return (
      this.timeouts?.() ?? {
        lsRemoteTimeoutMs: this.lsRemoteTimeoutMs,
        cloneTimeoutMs: this.cloneTimeoutMs,
      }
    );
  }

  parseRemoteUrl(rawUrl: string): RemoteRepoInfo {
    let value = rawUrl.trim();
    if (!value) {
      throw new Error("仓库地址不能为空");
    }
    if (value.startsWith("git@") || value.startsWith("ssh://")) {
      throw new Error(
        "暂不支持 SSH 地址，请使用 HTTPS 地址（用户名密码认证需要 HTTPS）",
      );
    }
    if (value.startsWith("http://")) {
      throw new Error("请使用 HTTPS 地址，不允许明文 HTTP");
    }
    if (!value.includes("://")) {
      value = `https://${value}`;
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("仓库地址格式无效");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("请使用 HTTPS 仓库地址");
    }

    const hostname = parsed.hostname.toLowerCase();
    const host =
      hostname === "github.com"
        ? "github"
        : hostname === "gitlab.com"
          ? "gitlab"
          : undefined;
    if (!host) {
      throw new Error("仅支持 github.com 和 gitlab.com 的仓库");
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("仓库地址需要包含 owner/repo，例如 github.com/owner/repo");
    }
    if (host === "github" && parts.length !== 2) {
      throw new Error("GitHub 仓库地址应为 owner/repo 两级");
    }
    if (parts.some((part) => !SEGMENT_PATTERN.test(part))) {
      throw new Error("owner/repo 包含非法字符");
    }
    const repo = parts[parts.length - 1].replace(/\.git$/, "");
    if (!repo) {
      throw new Error("仓库地址格式无效");
    }
    const owner = parts.slice(0, -1).join("/");

    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return {
      host,
      owner,
      repo,
      cloneUrl: parsed.toString().replace(/\/$/, ""),
    };
  }

  targetDir(reposRoot: string, info: RemoteRepoInfo): string {
    return join(reposRoot, info.host, info.owner, info.repo);
  }

  async lsRemote(
    info: RemoteRepoInfo,
    auth?: { username?: string; passwordOrToken?: string },
  ): Promise<void> {
    try {
      await this.runGit(["ls-remote", info.cloneUrl], {
        timeoutMs: this.effectiveTimeouts().lsRemoteTimeoutMs,
        auth,
      });
    } catch (error) {
      throw this.describeRemoteError(error, "无法访问远程仓库");
    }
  }

  async clone(options: CloneOptions): Promise<void> {
    const info = this.parseRemoteUrl(options.remoteUrl);
    const hasUsername = Boolean(options.username);
    const hasPassword = Boolean(options.passwordOrToken);
    if (hasUsername !== hasPassword) {
      throw new Error("用户名和密码/令牌需要同时填写");
    }

    if (existsSync(options.targetDir)) {
      throw new Error("目标目录已存在，请先清理后重试");
    }
    await mkdir(dirname(options.targetDir), { recursive: true });

    const auth = hasPassword
      ? {
          username: options.username,
          passwordOrToken: options.passwordOrToken,
        }
      : undefined;

    const emit = (progress: RemoteCloneProgress) => {
      options.onProgress?.(progress);
    };

    emit({ phase: "preflight", percent: null, message: "正在检查仓库可访问性..." });
    try {
      await this.lsRemote(info, auth);
    } catch (error) {
      await rm(options.targetDir, { recursive: true, force: true }).catch(
        () => {},
      );
      throw error;
    }

    const cloneArgs = ["clone", "--progress"];
    if (options.defaultBranch) {
      cloneArgs.push("--branch", options.defaultBranch, "--single-branch");
    }
    cloneArgs.push(info.cloneUrl, options.targetDir);

    emit({ phase: "cloning", percent: 0, message: "正在下载代码..." });
    try {
      await this.spawnGit(cloneArgs, {
        timeoutMs:
          options.timeoutMs ?? this.effectiveTimeouts().cloneTimeoutMs,
        auth,
        onStdErr: (line) => {
          const parsed = this.parseCloneProgress(line);
          if (parsed) {
            emit({ phase: "cloning", ...parsed });
          }
        },
      });
    } catch (error) {
      await rm(options.targetDir, { recursive: true, force: true }).catch(
        () => {},
      );
      throw this.describeRemoteError(error, "克隆仓库失败");
    }
    emit({ phase: "finalizing", percent: 100, message: "代码下载完成" });
  }

  private async runGit(
    args: string[],
    options: GitRunOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    const { env, cleanup } = await this.buildGitEnv(options.auth);
    try {
      return await execFileAsync("git", this.withUsername(args, options.auth), {
        cwd: options.cwd,
        env,
        timeout: options.timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      });
    } finally {
      await cleanup();
    }
  }

  private spawnGit(
    args: string[],
    options: {
      timeoutMs: number;
      cwd?: string;
      auth?: { username?: string; passwordOrToken?: string };
      onStdErr?: (line: string) => void;
    },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.buildGitEnv(options.auth)
        .then(({ env, cleanup }) => {
          const child = spawn("git", this.withUsername(args, options.auth), {
            cwd: options.cwd,
            env,
            stdio: ["ignore", "ignore", "pipe"],
          });

          let stderrBuffer = "";
          const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);

          child.stderr.setEncoding("utf8");
          child.stderr.on("data", (chunk: string) => {
            stderrBuffer += chunk;
            const lines = stderrBuffer.split(/\r?\n/);
            stderrBuffer = lines.pop() ?? "";
            for (const line of lines) {
              options.onStdErr?.(line);
            }
          });

          child.on("error", (error) => {
            clearTimeout(timer);
            void cleanup();
            reject(error);
          });

          child.on("close", (code) => {
            clearTimeout(timer);
            if (stderrBuffer) {
              options.onStdErr?.(stderrBuffer);
            }
            void cleanup();
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`git exited with code ${code ?? "unknown"}`));
            }
          });
        })
        .catch(reject);
    });
  }

  private withUsername(
    args: string[],
    auth?: { username?: string; passwordOrToken?: string },
  ): string[] {
    const fullArgs = [...args];
    if (auth?.username) {
      fullArgs.unshift("-c", `credential.username=${auth.username}`);
    }
    return fullArgs;
  }

  private async buildGitEnv(
    auth?: { username?: string; passwordOrToken?: string },
  ): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    };
    let askDir: string | null = null;
    if (auth?.passwordOrToken) {
      askDir = await mkdtemp(join(tmpdir(), "bugfix-harness-askpass-"));
      const isWindows = platform() === "win32";
      const askScript = join(askDir, isWindows ? "askpass.cmd" : "askpass.sh");
      if (isWindows) {
        await writeFile(askScript, "@echo off\r\necho %GIT_PASSWORD%\r\n");
      } else {
        await writeFile(
          askScript,
          "#!/bin/sh\nprintf '%s' \"$GIT_PASSWORD\"\n",
        );
        await chmod(askScript, 0o700);
      }
      env.GIT_ASKPASS = askScript;
      env.GIT_PASSWORD = auth.passwordOrToken;
    }
    return {
      env,
      cleanup: async () => {
        if (askDir) {
          await rm(askDir, { recursive: true, force: true }).catch(() => {});
        }
      },
    };
  }

  private parseCloneProgress(
    line: string,
  ): { percent: number | null; message: string } | null {
    const text = line.trim();
    if (!text) {
      return null;
    }
    const percentMatch = text.match(/(\d{1,3})%/);
    const percent = percentMatch
      ? Math.min(100, Number(percentMatch[1]))
      : null;

    let message = "";
    if (/receiving objects/i.test(text)) {
      message = "正在接收对象";
    } else if (/resolving deltas/i.test(text)) {
      message = "正在处理差异";
    } else if (/checking out files/i.test(text)) {
      message = "正在检出文件";
    } else if (/compressing objects/i.test(text)) {
      message = "正在压缩对象";
    } else if (/enumerating objects|counting objects/i.test(text)) {
      message = "正在统计对象";
    }

    if (!message && percent === null) {
      return null;
    }
    return { percent, message: message || text };
  }

  private describeRemoteError(error: unknown, fallback: string): Error {
    const raw = error instanceof Error ? error.message : String(error);
    const message = redactSensitive(raw);
    const lower = message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("invalid username or password") ||
      lower.includes("could not read username") ||
      lower.includes("access denied") ||
      lower.includes("401") ||
      lower.includes("403")
    ) {
      return new Error(
        "认证失败：请检查用户名和密码/令牌（GitHub 私有仓库请使用 Personal Access Token）",
      );
    }
    if (
      lower.includes("repository") &&
      (lower.includes("not found") || lower.includes("does not exist"))
    ) {
      return new Error("仓库不存在或没有访问权限");
    }
    return new Error(message ? `${fallback}: ${message}` : fallback);
  }
}
