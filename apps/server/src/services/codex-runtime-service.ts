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
  version?: string;
  reason?: string;
}

export interface CodexRuntimeInfo {
  runtimeCommand: string;
  codexBin: string | null;
  source: CodexRuntimeCandidate["source"] | null;
  available: boolean;
  version: string | null;
  warning?: string;
  candidates: CodexRuntimeCandidate[];
}

interface ExecutableInspection {
  available: boolean;
  version?: string;
}

function inspectExecutable(path: string): ExecutableInspection {
  try {
    if (!existsSync(path)) {
      return { available: false };
    }
    if (!statSync(path).isFile()) {
      return { available: false };
    }
    const result = spawnSync(path, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { available: false };
    }
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    const version = stdout || stderr || undefined;
    const available = result.status === 0;
    return { available, version };
  } catch {
    return { available: false };
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
      const inspection = inspectExecutable(normalized);
      inspected.push({
        path: normalized,
        source: candidate.source,
        available: inspection.available,
        version: inspection.version,
        reason: inspection.available
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
      version: firstAvailable?.version ?? null,
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
    if (!inspectExecutable(normalized).available) {
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
