import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "untracked" | "renamed";
}

export interface DiffResult {
  files: FileChange[];
  unifiedDiff: string;
  stats: {
    total: number;
    added: number;
    modified: number;
    deleted: number;
    untracked: number;
    renamed: number;
  };
}

function statusFromPorcelain(code: string): FileChange["status"] {
  if (code === "??") {
    return "untracked";
  }
  if (code === "A" || code === "A ") {
    return "added";
  }
  if (code === "D" || code === " D") {
    return "deleted";
  }
  if (code.includes("R")) {
    return "renamed";
  }
  if (code.includes("C")) {
    return "added";
  }
  return "modified";
}

function parsePorcelainStatus(output: string): FileChange[] {
  const entries = output.split("\0");
  const files: FileChange[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }

    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    const status = statusFromPorcelain(code);

    if (code.includes("R") || code.includes("C")) {
      // `--porcelain=v1 -z` emits the destination path first, followed by the
      // source path as a separate NUL-terminated record.
      const destination = path;
      index += 1;
      files.push({ path: destination, status });
      continue;
    }

    files.push({ path, status });
  }

  return files;
}

async function runGit(args: string[], allowFailure = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { encoding: "utf8" });
    return stdout;
  } catch (error) {
    const output = (error as { stdout?: string; stderr?: string }).stdout ?? "";
    if (allowFailure) {
      return output;
    }
    throw error;
  }
}

export class DiffService {
  async generate(worktreePath: string): Promise<DiffResult> {
    const status = await runGit([
      "-C",
      worktreePath,
      "status",
      "--porcelain=v1",
      "-z",
      "-uall",
    ]);

    const files: FileChange[] = parsePorcelainStatus(status);

    const diffs: string[] = [];
    const trackedDiff = await runGit([
      "-C",
      worktreePath,
      "diff",
      "HEAD",
      "--",
    ]);
    if (trackedDiff.trim()) {
      diffs.push(trackedDiff);
    }

    const emptyPath = process.platform === "win32" ? "NUL" : "/dev/null";
    for (const file of files.filter((item) => item.status === "untracked")) {
      const diff = await runGit(
        ["-C", worktreePath, "diff", "--no-index", "--", emptyPath, file.path],
        true,
      );
      if (diff.trim()) {
        diffs.push(diff);
      }
    }

    const stats = {
      total: files.length,
      added: files.filter((item) => item.status === "added").length,
      modified: files.filter((item) => item.status === "modified").length,
      deleted: files.filter((item) => item.status === "deleted").length,
      untracked: files.filter((item) => item.status === "untracked").length,
      renamed: files.filter((item) => item.status === "renamed").length,
    };

    return {
      files,
      unifiedDiff: diffs.join("\n"),
      stats,
    };
  }
}
