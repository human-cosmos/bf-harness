import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitWorktreeManager } from "../src/services/worktree-manager.js";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

describe("GitWorktreeManager", () => {
  it("creates an isolated worktree without modifying the main repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-harness-worktree-"));
    const repo = join(root, "repo");
    const worktreeRoot = join(root, "worktrees");

    try {
      git(["init", repo]);
      git(["-C", repo, "config", "user.email", "spike@example.com"]);
      git(["-C", repo, "config", "user.name", "Spike"]);
      writeFileSync(join(repo, "main.txt"), "unchanged\n");
      git(["-C", repo, "add", "main.txt"]);
      git(["-C", repo, "commit", "-m", "baseline"]);
      const baseline = git(["-C", repo, "rev-parse", "HEAD"]);

      const manager = new GitWorktreeManager();
      const taskId = "task-1";
      const result = await manager.create({ taskId, repoPath: repo, root: worktreeRoot });

      expect(result.baseCommit).toBe(baseline);
      expect(existsSync(result.path)).toBe(true);
      expect(existsSync(join(repo, "task-1"))).toBe(false);
      expect(git(["-C", repo, "status", "--porcelain"])).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a non-git repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-harness-nongit-"));
    try {
      const manager = new GitWorktreeManager();
      await expect(manager.validateRepository(root)).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
