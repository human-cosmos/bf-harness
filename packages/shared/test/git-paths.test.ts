import { describe, expect, it } from "vitest";
import { decodeGitPath } from "../src/index.js";

describe("decodeGitPath", () => {
  it("returns unquoted paths unchanged", () => {
    expect(decodeGitPath("foo/bar.txt")).toBe("foo/bar.txt");
  });

  it("decodes a quoted path with spaces", () => {
    expect(decodeGitPath('"sub/foo bar.txt"')).toBe("sub/foo bar.txt");
  });

  it("decodes C-style octal escapes to UTF-8", () => {
    expect(
      decodeGitPath(
        '"sub/\\346\\265\\213\\350\\257\\225 \\346\\226\\207\\344\\273\\266.txt"',
      ),
    ).toBe("sub/测试 文件.txt");
  });

  it("decodes common single-character escapes", () => {
    expect(decodeGitPath('"a/x\\t\\n\\"\\\\y"')).toBe('a/x\t\n"\\y');
  });

  it("preserves unknown escapes instead of dropping them", () => {
    expect(decodeGitPath('"a\\qb"')).toBe("a\\qb");
  });
});
