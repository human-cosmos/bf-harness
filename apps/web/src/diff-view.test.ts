import { describe, expect, it } from "vitest";
import { splitUnifiedDiffByFile } from "./pages.js";

describe("splitUnifiedDiffByFile", () => {
  it("extracts an ascii path from a text diff", () => {
    const diff = [
      "diff --git a/main.txt b/main.txt",
      "index 1111111..2222222 100644",
      "--- a/main.txt",
      "+++ b/main.txt",
      "@@ -1 +1 @@",
      "-one",
      "+two",
    ].join("\n");

    expect(splitUnifiedDiffByFile(diff)).toEqual([
      expect.objectContaining({ path: "main.txt" }),
    ]);
  });

  it("keeps spaces in unquoted paths", () => {
    const diff = [
      "diff --git a/sub/foo bar.txt b/sub/foo bar.txt",
      "index 1111111..2222222 100644",
      "--- a/sub/foo bar.txt",
      "+++ b/sub/foo bar.txt",
      "@@ -1 +1 @@",
      "-one",
      "+two",
    ].join("\n");

    expect(splitUnifiedDiffByFile(diff)[0]?.path).toBe("sub/foo bar.txt");
  });

  it("decodes C-style quoted non-ascii paths", () => {
    const diff = [
      'diff --git "a/sub/\\346\\265\\213\\350\\257\\225 \\346\\226\\207\\344\\273\\266.txt" "b/sub/\\346\\265\\213\\350\\257\\225 \\346\\226\\207\\344\\273\\266.txt"',
      "index 1111111..2222222 100644",
      '--- "a/sub/\\346\\265\\213\\350\\257\\225 \\346\\226\\207\\344\\273\\266.txt"',
      '+++ "b/sub/\\346\\265\\213\\350\\257\\225 \\346\\226\\207\\344\\273\\266.txt"',
      "@@ -1 +1 @@",
      "-one",
      "+two",
    ].join("\n");

    expect(splitUnifiedDiffByFile(diff)[0]?.path).toBe("sub/测试 文件.txt");
  });

  it("prefers the b-side path for renames", () => {
    const diff = [
      "diff --git a/old.txt b/new.txt",
      "similarity index 90%",
      "rename from old.txt",
      "rename to new.txt",
      "--- a/old.txt",
      "+++ b/new.txt",
      "@@ -1 +1 @@",
      "-one",
      "+two",
    ].join("\n");

    expect(splitUnifiedDiffByFile(diff)[0]?.path).toBe("new.txt");
  });

  it("uses the b-side path for added files and the a-side for deleted files", () => {
    const added = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1 @@",
      "+new",
    ].join("\n");
    const deleted = [
      "diff --git a/old.txt b/old.txt",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "--- a/old.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-one",
    ].join("\n");

    expect(splitUnifiedDiffByFile(added)[0]?.path).toBe("new.txt");
    expect(splitUnifiedDiffByFile(deleted)[0]?.path).toBe("old.txt");
  });

  it("falls back to the diff header for binary diffs", () => {
    const diff = [
      "diff --git a/bin.dat b/bin.dat",
      "index 1111111..2222222 100644",
      "Binary files a/bin.dat and b/bin.dat differ",
    ].join("\n");

    expect(splitUnifiedDiffByFile(diff)[0]?.path).toBe("bin.dat");
  });
});
