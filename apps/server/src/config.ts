import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const localCodexBin = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../codex-harness/codex-rs/target/debug/codex",
);

export interface AppConfig {
  home: string;
  databasePath: string;
  worktreeRoot: string;
  port: number;
  host: string;
  codexBin: string;
  analysisTimeoutMs: number;
  implementationTimeoutMs: number;
  analysisMaxTimeoutMs: number | null;
  implementationMaxTimeoutMs: number | null;
}

export function loadConfig(): AppConfig {
  const home =
    process.env.BUGFIX_HARNESS_HOME ?? join(homedir(), ".bugfix-harness");
  return {
    home,
    databasePath: join(home, "data.sqlite"),
    worktreeRoot: join(home, "worktrees"),
    port: Number(process.env.BUGFIX_HARNESS_PORT ?? 4317),
    host: process.env.BUGFIX_HARNESS_HOST ?? "127.0.0.1",
    codexBin:
      process.env.CODEX_BIN ??
      (existsSync(localCodexBin) ? localCodexBin : "codex-harness"),
    analysisTimeoutMs: Number(
      process.env.BUGFIX_HARNESS_ANALYSIS_TIMEOUT_MS ?? 600_000,
    ),
    implementationTimeoutMs: Number(
      process.env.BUGFIX_HARNESS_IMPLEMENTATION_TIMEOUT_MS ?? 600_000,
    ),
    analysisMaxTimeoutMs: optionalPositiveNumber(
      process.env.BUGFIX_HARNESS_ANALYSIS_MAX_DURATION_MS,
    ),
    implementationMaxTimeoutMs: optionalPositiveNumber(
      process.env.BUGFIX_HARNESS_IMPLEMENTATION_MAX_DURATION_MS,
    ),
  };
}

function optionalPositiveNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
