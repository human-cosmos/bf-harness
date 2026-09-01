import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveLongPath } from "./fs-paths.js";

const execFileAsync = promisify(execFile);

export interface WorktreeCreationInput {
  taskId: string;
  repoPath: string;
  root: string;
}

export interface WorktreeCreationResult {
  path: string;
  baseCommit: string;
  branch: string;
}

export class GitWorktreeManager {
  async validateRepository(repoPath: string): Promise<void> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("git", [
        "-C",
        repoPath,
        "rev-parse",
        "--is-inside-work-tree",
      ]));
    } catch {
      throw new Error("该目录不是 Git 仓库，请选择包含 .git 的仓库根目录。");
    }
    if (stdout.trim() !== "true") {
      throw new Error("该目录不是 Git 仓库，请选择包含 .git 的仓库根目录。");
    }
  }

  async readBaseCommit(repoPath: string): Promise<string> {
    const { stdout } = await execFileAsync("git", [
      "-C",
      repoPath,
      "rev-parse",
      "HEAD",
    ]);
    return stdout.trim();
  }

  async create(input: WorktreeCreationInput): Promise<WorktreeCreationResult> {
    await this.validateRepository(input.repoPath);
    const baseCommit = await this.readBaseCommit(input.repoPath);
    const path = join(input.root, input.taskId);
    const branch = `harness/${input.taskId}`;

    if (existsSync(path)) {
      throw new Error(`Worktree path already exists: ${path}`);
    }

    try {
      await execFileAsync("git", ["-C", input.repoPath, "worktree", "prune"]);
      if (await this.branchExists(input.repoPath, branch)) {
        await execFileAsync("git", [
          "-C",
          input.repoPath,
          "worktree",
          "add",
          path,
          branch,
        ]);
      } else {
      await execFileAsync("git", [
        "-C",
        input.repoPath,
        "worktree",
        "add",
        "-b",
        branch,
        path,
        baseCommit,
      ]);
      }
    } catch (error) {
      await this.cleanupIncomplete(input.repoPath, path);
      throw new Error(
        `Failed to create worktree: ${(error as Error).message}`,
      );
    }

    return { path: resolveLongPath(path), baseCommit, branch };
  }

  private async branchExists(
    repoPath: string,
    branch: string,
  ): Promise<boolean> {
    try {
      await execFileAsync("git", [
        "-C",
        repoPath,
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async cleanupIncomplete(repoPath: string, path: string): Promise<void> {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
    try {
      await execFileAsync("git", ["-C", repoPath, "worktree", "prune"]);
    } catch {
      // Keep the original failure. Cleanup is best-effort.
    }
  }

  async remove(repoPath: string, path: string): Promise<void> {
    try {
      await execFileAsync("git", [
        "-C",
        repoPath,
        "worktree",
        "remove",
        "--force",
        path,
      ]);
    } finally {
      await execFileAsync("git", ["-C", repoPath, "worktree", "prune"]);
    }
  }
}
