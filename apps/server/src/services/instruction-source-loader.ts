import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

const MAX_INSTRUCTION_SOURCE_BYTES = 1_000_000;
const RUNTIME_AUTO_LOADED_SOURCES = new Set(["agents.md", "agents.override.md"]);

export interface InstructionSourceContext {
  repoPath: string;
  worktreePath: string;
  instructionSources: string[];
}

function isInside(root: string, target: string): boolean {
  if (!isAbsolute(root) || !isAbsolute(target)) {
    return false;
  }

  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveInstructionSource(
  source: string,
  repoPath: string,
  worktreePath: string,
): string | null {
  if (isAbsolute(source)) {
    const absolute = resolve(source);
    if (!isInside(repoPath, absolute)) {
      return null;
    }

    return join(worktreePath, relative(repoPath, absolute));
  }

  const target = resolve(worktreePath, source);
  return isInside(worktreePath, target) ? target : null;
}

export async function loadInstructionSources(
  context: InstructionSourceContext,
): Promise<string> {
  const sections: string[] = [];

  for (const source of context.instructionSources) {
    const trimmed = source.trim();
    if (!trimmed) {
      continue;
    }
    if (RUNTIME_AUTO_LOADED_SOURCES.has(basename(trimmed).toLowerCase())) {
      continue;
    }

    const target = resolveInstructionSource(
      trimmed,
      context.repoPath,
      context.worktreePath,
    );
    if (!target) {
      console.warn(
        `Skipping instruction source outside the worktree: ${trimmed}`,
      );
      continue;
    }

    try {
      const buffer = await readFile(target);
      if (buffer.byteLength > MAX_INSTRUCTION_SOURCE_BYTES) {
        console.warn(
          `Skipping oversized instruction source (${buffer.byteLength} bytes): ${trimmed}`,
        );
        continue;
      }

      const content = buffer.toString("utf8").trim();
      if (!content) {
        continue;
      }

      sections.push(`Source: ${trimmed}\n\n${content}`);
    } catch (error) {
      console.warn(
        `Skipping unreadable instruction source ${trimmed}: ${
          (error as Error).message
        }`,
      );
    }
  }

  if (sections.length === 0) {
    return "";
  }

  return [
    "The following repository instructions are authoritative for this bugfix task.",
    "Follow them unless they conflict with the explicit constraints in the task contract.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}
