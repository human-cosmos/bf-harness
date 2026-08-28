import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadInstructionSources } from "../src/services/instruction-source-loader.js";

describe("loadInstructionSources", () => {
  it("loads relative and repo-absolute sources from the worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-instructions-"));
    const repo = join(root, "repo");
    const worktree = join(root, "worktree");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(join(worktree, "docs", "STANDARDS.md"), "Always run tests first.\n");
    writeFileSync(join(worktree, "docs", "CONTRIBUTING.md"), "Use lowercase commits.\n");

    try {
      const context = await loadInstructionSources({
        repoPath: repo,
        worktreePath: worktree,
        instructionSources: [
          "docs/STANDARDS.md",
          join(repo, "docs", "CONTRIBUTING.md"),
        ],
      });

      expect(context).toContain("Source: docs/STANDARDS.md");
      expect(context).toContain("Always run tests first.");
      expect(context).toContain("Source: /");
      expect(context).toContain("Use lowercase commits.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips missing, empty, and out-of-worktree sources without failing", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-instructions-"));
    const repo = join(root, "repo");
    const worktree = join(root, "worktree");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, "EMPTY.md"), "\n");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const context = await loadInstructionSources({
        repoPath: repo,
        worktreePath: worktree,
        instructionSources: [
          "AGENTS.md",
          "AGENTS.override.md",
          "EMPTY.md",
          "MISSING.md",
          "/etc/passwd",
        ],
      });

      expect(context).toBe("");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("outside the worktree"),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("unreadable instruction source MISSING.md"),
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("AGENTS.md"),
      );
    } finally {
      warn.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an empty string when no instruction sources are configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "bugfix-instructions-"));
    try {
      await expect(
        loadInstructionSources({
          repoPath: join(root, "repo"),
          worktreePath: join(root, "worktree"),
          instructionSources: [],
        }),
      ).resolves.toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
