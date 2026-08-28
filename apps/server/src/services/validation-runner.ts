import { spawn } from "node:child_process";
import type { ValidationCommand } from "@bugfix-harness/shared";

export type ValidationStatus = "passed" | "failed" | "timeout" | "skipped";

export interface ValidationOutcome {
  command: ValidationCommand;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  status: ValidationStatus;
  stdout: string;
  stderr: string;
  skipReason?: string;
}

const MAX_OUTPUT_BYTES = 1_000_000;

function truncateOutput(value: string): string {
  return value.length > MAX_OUTPUT_BYTES
    ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n...[output truncated]`
    : value;
}

export class ValidationRunner {
  async run(
    command: ValidationCommand,
    cwd: string,
  ): Promise<ValidationOutcome> {
    const startedAt = new Date().toISOString();
    return new Promise((resolve) => {
      if (!Array.isArray(command.command) || command.command.length === 0) {
        resolve({
          command,
          cwd,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode: null,
          status: "failed",
          stdout: "",
          stderr: "Validation command must be a non-empty argument array",
        });
        return;
      }

      const child = spawn(command.command[0], command.command.slice(1), {
        cwd,
        env: process.env,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          resolve({
            command,
            cwd,
            startedAt,
            finishedAt: new Date().toISOString(),
            exitCode: null,
            status: "timeout",
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(`${stderr}\nValidation timed out`),
          });
        }
      }, command.timeoutSec * 1000);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({
            command,
            cwd,
            startedAt,
            finishedAt: new Date().toISOString(),
            exitCode: null,
            status: "failed",
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(`${stderr}\n${error.message}`),
          });
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({
            command,
            cwd,
            startedAt,
            finishedAt: new Date().toISOString(),
            exitCode: code,
            status: code === 0 ? "passed" : "failed",
            stdout: truncateOutput(stdout),
            stderr: truncateOutput(stderr),
          });
        }
      });
    });
  }

  skipped(
    command: ValidationCommand,
    cwd: string,
    skipReason: string,
  ): ValidationOutcome {
    const now = new Date().toISOString();
    return {
      command,
      cwd,
      startedAt: now,
      finishedAt: now,
      exitCode: null,
      status: "skipped",
      stdout: "",
      stderr: "",
      skipReason,
    };
  }
}
