import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiffService } from "../src/services/diff-service.js";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

describe("DiffService", () => {
  it("reports modified and untracked files", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-diff-"));
    const repo = join(root, "repo");
    try {
      git(["init", repo]);
      git(["-C", repo, "config", "user.email", "spike@example.com"]);
      git(["-C", repo, "config", "user.name", "Spike"]);
      writeFileSync(join(repo, "main.txt"), "one\n");
      git(["-C", repo, "add", "main.txt"]);
      git(["-C", repo, "commit", "-m", "baseline"]);
      writeFileSync(join(repo, "main.txt"), "two\n");
      writeFileSync(join(repo, "new.txt"), "new\n");

      const result = await new DiffService().generate(repo);
      expect(result.files).toHaveLength(2);
      expect(result.stats.modified).toBe(1);
      expect(result.stats.untracked).toBe(1);
      expect(result.unifiedDiff).toContain("new.txt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
