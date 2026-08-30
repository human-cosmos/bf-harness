import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { SystemSettingsService } from "./system-settings-service.js";

const RUNTIME_COMMAND = "codex-harness app-server --stdio";

const localCodexBin = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../codex-harness/codex-rs/target/debug/codex",
);

export interface CodexRuntimeCandidate {
  path: string;
  source: "explicit" | "env" | "fallback" | "local-build" | "path";
  available: boolean;
  reason?: string;
}

export interface CodexRuntimeInfo {
  runtimeCommand: string;
  codexBin: string | null;
  source: CodexRuntimeCandidate["source"] | null;
  available: boolean;
  warning?: string;
  candidates: CodexRuntimeCandidate[];
}

function isExecutableFile(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    if (!statSync(path).isFile()) return false;
    const result = spawnSync(path, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) return false;
    return result.status === 0 || result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function pathCandidates(commandName: string, pathValue: string): string[] {
  const paths: string[] = [];
  for (const dir of pathValue.split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    paths.push(join(dir, commandName));
    if (process.platform === "win32") {
      paths.push(join(dir, `${commandName}.exe`));
    }
  }
  return paths;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class CodexRuntimeService {
  constructor(
    private readonly settings: SystemSettingsService,
    private readonly fallbackCodexBin?: string,
    private readonly pathEnv: string | undefined = process.env.PATH,
    private readonly envCodexBin: string | undefined = process.env.CODEX_BIN,
  ) {}

  detect(): CodexRuntimeInfo {
    const explicit = this.settings.get().runtime.codexBin?.trim();
    const candidates: Array<{
      path: string;
      source: CodexRuntimeCandidate["source"];
    }> = [];

    if (explicit) {
      candidates.push({ path: explicit, source: "explicit" });
    }

    const envBin = this.envCodexBin?.trim();
    if (envBin) {
      candidates.push({ path: envBin, source: "env" });
    }

    if (this.fallbackCodexBin?.trim()) {
      candidates.push({ path: this.fallbackCodexBin.trim(), source: "fallback" });
    }

    candidates.push({ path: localCodexBin, source: "local-build" });
    const pathValue = this.pathEnv ?? "";
    for (const path of unique([
      ...pathCandidates("codex-harness", pathValue),
      ...pathCandidates("codex", pathValue),
    ])) {
      candidates.push({ path, source: "path" });
    }

    const inspected: CodexRuntimeCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const normalized = candidate.path.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      const available = isExecutableFile(normalized);
      inspected.push({
        path: normalized,
        source: candidate.source,
        available,
        reason: available
          ? undefined
          : "文件不存在、不可执行，或无法作为 Codex 运行。",
      });
    }

    const firstAvailable = inspected.find((item) => item.available) ?? null;
    return {
      runtimeCommand: RUNTIME_COMMAND,
      codexBin: firstAvailable?.path ?? null,
      source: firstAvailable?.source ?? null,
      available: Boolean(firstAvailable),
      warning: firstAvailable
        ? undefined
        : "未检测到可用的 CODEX_BIN 运行环境，请手动指定可执行文件。",
      candidates: inspected,
    };
  }

  saveManualCodexBin(path: string): CodexRuntimeInfo {
    const normalized = path.trim();
    if (!normalized) {
      throw new Error("CODEX_BIN path is required");
    }
    if (!isExecutableFile(normalized)) {
      throw new Error("所选文件不存在、不可执行，或无法作为 Codex 运行。");
    }

    const current = this.settings.get();
    this.settings.save({
      ...current,
      runtime: {
        ...current.runtime,
        codexBin: normalized,
      },
    });
    return this.detect();
  }

  resolveCodexBin(): string | null {
    return this.detect().codexBin;
  }
}
