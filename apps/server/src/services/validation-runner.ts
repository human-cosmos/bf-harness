import { spawn } from "node:child_process";
import type { ValidationCommand } from "@bugfix-harness/shared";
import { terminateChildTree } from "./process-guard.js";

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

interface OutputBuffer {
  append(chunk: string): void;
  toString(): string;
}

function createOutputBuffer(maxBytes: number): OutputBuffer {
  let value = "";
  let truncated = false;

  return {
    append(chunk: string) {
      if (truncated) {
        return;
      }
      value += chunk;
      if (value.length > maxBytes) {
        value = value.slice(0, maxBytes);
        truncated = true;
      }
    },
    toString() {
      return truncated ? `${value}\n...[output truncated]` : value;
    },
  };
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

      const stdout = createOutputBuffer(MAX_OUTPUT_BYTES);
      const stderr = createOutputBuffer(MAX_OUTPUT_BYTES);
      let settled = false;

      const finish = (outcome: Omit<ValidationOutcome, "command" | "cwd" | "startedAt">) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ command, cwd, startedAt, ...outcome });
      };

      const timer = setTimeout(() => {
        terminateChildTree(child);
        finish({
          finishedAt: new Date().toISOString(),
          exitCode: null,
          status: "timeout",
          stdout: stdout.toString(),
          stderr: `${stderr.toString()}\nValidation timed out`,
        });
      }, command.timeoutSec * 1000);

      child.stdout.on("data", (chunk) => {
        stdout.append(chunk.toString());
      });
      child.stderr.on("data", (chunk) => {
        stderr.append(chunk.toString());
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        finish({
          finishedAt: new Date().toISOString(),
          exitCode: null,
          status: "failed",
          stdout: stdout.toString(),
          stderr: `${stderr.toString()}\n${error.message}`,
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish({
          finishedAt: new Date().toISOString(),
          exitCode: code,
          status: code === 0 ? "passed" : "failed",
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
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
