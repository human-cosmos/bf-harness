import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface DynamicToolCallInput {
  threadId?: string;
  turnId?: string;
  callId?: string;
  namespace?: string | null;
  tool: string;
  arguments: unknown;
}

export interface DynamicToolCallResult {
  contentItems: Array<{ type: "inputText"; text: string }>;
  success: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function resolveWithinRoot(root: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("path is required");
  }
  const resolved = isAbsolute(value) ? resolve(value) : resolve(root, value);
  if (!isInside(root, resolved)) {
    throw new Error("path is outside the conversation project root");
  }
  return resolved;
}

function assertRealPathWithinRoot(root: string, resolved: string): void {
  const realRoot = realpathSync(root);
  let probe = resolved;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = realpathSync(probe);
  if (!isInside(realRoot, realProbe)) {
    throw new Error("resolved path escapes the conversation project root");
  }
}

function textResult(text: string, success: boolean): DynamicToolCallResult {
  return {
    contentItems: [{ type: "inputText", text }],
    success,
  };
}

function walkFiles(root: string, maxResults: number): string[] {
  const results: string[] = [];
  const stack = [root];
  const visited = new Set<string>();

  while (stack.length > 0 && results.length < maxResults) {
    const current = stack.pop()!;
    const real = resolve(current);
    if (visited.has(real)) continue;
    visited.add(real);

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        results.push(relative(root, fullPath));
        if (results.length >= maxResults) break;
      }
    }
  }

  return results.sort();
}

export class DynamicToolRegistry {
  constructor(private readonly projectRoot: string) {}

  async call(input: DynamicToolCallInput): Promise<DynamicToolCallResult> {
    const args = asRecord(input.arguments);

    try {
      const tool = input.namespace
        ? input.tool.startsWith(`${input.namespace}/`)
          ? input.tool
          : `${input.namespace}/${input.tool}`
        : input.tool;

      if (tool === "fs/readFile") {
        const path = resolveWithinRoot(this.projectRoot, args.path);
        assertRealPathWithinRoot(this.projectRoot, path);
        return textResult(readFileSync(path, "utf8"), true);
      }

      if (tool === "fs/writeFile") {
        const path = resolveWithinRoot(this.projectRoot, args.path);
        assertRealPathWithinRoot(this.projectRoot, path);
        const content =
          typeof args.content === "string"
            ? args.content
            : typeof args.data === "string"
              ? args.data
              : JSON.stringify(args.content ?? args.data ?? "");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
        return textResult(`wrote ${relative(this.projectRoot, path)}`, true);
      }

      if (tool === "fs/createDirectory") {
        const path = resolveWithinRoot(this.projectRoot, args.path);
        assertRealPathWithinRoot(this.projectRoot, path);
        mkdirSync(path, { recursive: true });
        return textResult(`created ${relative(this.projectRoot, path)}`, true);
      }

      if (tool === "fs/readDirectory") {
        const path = resolveWithinRoot(this.projectRoot, args.path);
        assertRealPathWithinRoot(this.projectRoot, path);
        const entries = readdirSync(path, { withFileTypes: true }).map(
          (entry) => ({
            name: entry.name,
            path: join(relative(this.projectRoot, path), entry.name),
            kind: entry.isDirectory()
              ? "directory"
              : entry.isFile()
                ? "file"
                : "other",
          }),
        );
        return textResult(JSON.stringify(entries, null, 2), true);
      }

      if (tool === "fs/getMetadata") {
        const path = resolveWithinRoot(this.projectRoot, args.path);
        assertRealPathWithinRoot(this.projectRoot, path);
        const stat = statSync(path);
        return textResult(
          JSON.stringify(
            {
              path: relative(this.projectRoot, path),
              exists: existsSync(path),
              isDirectory: stat.isDirectory(),
              isFile: stat.isFile(),
              size: stat.size,
              modifiedAtMs: stat.mtimeMs,
            },
            null,
            2,
          ),
          true,
        );
      }

      if (tool === "fuzzyFileSearch") {
        const query = String(args.query ?? "").toLowerCase();
        const files = walkFiles(this.projectRoot, 100);
        const matches = query
          ? files.filter((file) => file.toLowerCase().includes(query))
          : files.slice(0, 20);
        return textResult(JSON.stringify(matches, null, 2), true);
      }

      return textResult(
        `Dynamic tool not implemented: ${tool}`,
        false,
      );
    } catch (error) {
      return textResult((error as Error).message, false);
    }
  }
}
