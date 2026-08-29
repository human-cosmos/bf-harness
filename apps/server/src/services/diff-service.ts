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
  if (code[0] === "A") {
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

const utf8Decoder = new TextDecoder();

interface ParsedChange {
  path: string;
  status: FileChange["status"];
}

function splitNul(output: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === 0) {
      records.push(output.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < output.length) {
    records.push(output.subarray(start));
  }
  return records;
}

function parsePorcelainStatus(output: Buffer): ParsedChange[] {
  const entries = splitNul(output);
  const files: ParsedChange[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length === 0) {
      continue;
    }

    // `--porcelain=v1 -z` emits `XY <path>` per record. The first two bytes are
    // the status code, the third is a separator space.
    const code = entry.toString("latin1", 0, 2);
    const rawPath = entry.subarray(3);
    const status = statusFromPorcelain(code);

    if (code.includes("R") || code.includes("C")) {
      // Rename/copy records carry the destination path first, immediately
      // followed by the source path as its own NUL-terminated record.
      index += 1;
      files.push({ path: utf8Decoder.decode(rawPath), status });
      continue;
    }

    files.push({ path: utf8Decoder.decode(rawPath), status });
  }

  return files;
}

async function runGit(args: readonly string[], allowFailure = false): Promise<string> {
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

async function runGitBytes(args: readonly string[], allowFailure = false): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync("git", args, { encoding: "buffer" });
    return stdout;
  } catch (error) {
    const output = (error as { stdout?: Buffer }).stdout ?? Buffer.alloc(0);
    if (allowFailure) {
      return output;
    }
    throw error;
  }
}

export class DiffService {
  async generate(worktreePath: string): Promise<DiffResult> {
    const status = await runGitBytes([
      "-C",
      worktreePath,
      "status",
      "--porcelain=v1",
      "-z",
    ]);

    const parsed: ParsedChange[] = parsePorcelainStatus(status);
    const files: FileChange[] = parsed.map(({ path, status }) => ({
      path,
      status,
    }));

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
    for (const file of parsed.filter((item) => item.status === "untracked")) {
      // Untracked directories are listed as a single `?? dir/` entry (trailing
      // slash). Skip them rather than diffing an entire directory tree (which
      // can fork one git process per contained file).
      if (file.path.endsWith("/")) {
        continue;
      }
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
