import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("returns raw paths for spaces, non-ascii, renames and untracked files", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-diff-"));
    const repo = join(root, "repo");
    try {
      git(["init", repo]);
      git(["-C", repo, "config", "user.email", "spike@example.com"]);
      git(["-C", repo, "config", "user.name", "Spike"]);
      writeFileSync(join(repo, "foo bar.txt"), "one\n");
      writeFileSync(join(repo, "测试 文件.txt"), "one\n");
      git(["-C", repo, "add", "foo bar.txt", "测试 文件.txt"]);
      git(["-C", repo, "commit", "-m", "baseline"]);

      git(["-C", repo, "mv", "foo bar.txt", "new name.txt"]);
      writeFileSync(join(repo, "测试 文件.txt"), "two\n");
      writeFileSync(join(repo, "untracked file.txt"), "new\n");

      const result = await new DiffService().generate(repo);

      expect(result.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "new name.txt",
          "测试 文件.txt",
          "untracked file.txt",
        ]),
      );
      expect(result.files.find((file) => file.path === "new name.txt")?.status)
        .toBe("renamed");
      expect(result.stats.renamed).toBe(1);
      expect(result.stats.modified).toBe(1);
      expect(result.stats.untracked).toBe(1);
      expect(result.unifiedDiff).toContain("untracked file.txt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes staged changes in the unified diff", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-diff-"));
    const repo = join(root, "repo");
    try {
      git(["init", repo]);
      git(["-C", repo, "config", "user.email", "spike@example.com"]);
      git(["-C", repo, "config", "user.name", "Spike"]);
      writeFileSync(join(repo, "staged.txt"), "one\n");
      git(["-C", repo, "add", "staged.txt"]);
      git(["-C", repo, "commit", "-m", "baseline"]);

      writeFileSync(join(repo, "staged.txt"), "two\n");
      git(["-C", repo, "add", "staged.txt"]);

      const result = await new DiffService().generate(repo);

      expect(result.files.map((file) => file.path)).toContain("staged.txt");
      expect(result.unifiedDiff).toContain("+two");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a staged-then-edited new file as added (AM)", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-diff-"));
    const repo = join(root, "repo");
    try {
      git(["init", repo]);
      git(["-C", repo, "config", "user.email", "spike@example.com"]);
      git(["-C", repo, "config", "user.name", "Spike"]);
      writeFileSync(join(repo, "seed.txt"), "one\n");
      git(["-C", repo, "add", "seed.txt"]);
      git(["-C", repo, "commit", "-m", "baseline"]);

      writeFileSync(join(repo, "added.txt"), "one\n");
      git(["-C", repo, "add", "added.txt"]);
      writeFileSync(join(repo, "added.txt"), "two\n");

      const result = await new DiffService().generate(repo);
      const added = result.files.find((file) => file.path === "added.txt");

      expect(added?.status).toBe("added");
      expect(result.stats.added).toBe(1);
      expect(result.stats.modified).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("collapses untracked directories instead of expanding every file", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-diff-"));
    const repo = join(root, "repo");
    try {
      git(["init", repo]);
      git(["-C", repo, "config", "user.email", "spike@example.com"]);
      git(["-C", repo, "config", "user.name", "Spike"]);
      writeFileSync(join(repo, "tracked.txt"), "one\n");
      git(["-C", repo, "add", "tracked.txt"]);
      git(["-C", repo, "commit", "-m", "baseline"]);

      mkdirSync(join(repo, "src"), { recursive: true });
      mkdirSync(join(repo, "test"), { recursive: true });
      writeFileSync(join(repo, "src/index.js"), "module.exports = 1;\n");
      writeFileSync(join(repo, "src/util.js"), "module.exports = 2;\n");
      writeFileSync(join(repo, "test/index.test.js"), "test('x', () => {});\n");

      const result = await new DiffService().generate(repo);
      const paths = result.files.map((file) => file.path);

      // Untracked directories are reported as collapsed entries and their
      // contents are not expanded or diffed, avoiding one git subprocess per
      // contained file (which blows up for vendored trees like node_modules).
      expect(paths).toEqual(expect.arrayContaining(["src/", "test/"]));
      expect(paths).not.toContain("src/index.js");
      expect(paths).not.toContain("src/util.js");
      expect(paths).not.toContain("test/index.test.js");
      expect(result.stats.untracked).toBe(2);
      expect(result.unifiedDiff).not.toContain("src/index.js");
      expect(result.unifiedDiff).not.toContain("src/util.js");
      expect(result.unifiedDiff).not.toContain("test/index.test.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
