import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  resolveSpawnExecutable,
  terminateChildTree,
} from "../src/services/process-guard.js";

describe("process guard", () => {
  it("terminates a detached child process tree", async () => {
    const child = spawn(
      "node",
      ["-e", "setTimeout(() => {}, 10000)"],
      {
        detached: true,
        stdio: "ignore",
      },
    );

    const exited = new Promise<number | null>((resolve) => {
      child.on("exit", (code, signal) => resolve(code ?? (signal ? -1 : null)));
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    terminateChildTree(child);

    const result = await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    expect(result).not.toBeNull();
  });

  it("resolves npm to a Windows cmd shim when present", () => {
    const resolved = resolveSpawnExecutable("npm");
    if (process.platform === "win32") {
      expect(resolved.executable.toLowerCase()).toMatch(/npm\.cmd$/);
      expect(resolved.useShell).toBe(true);
    } else {
      expect(resolved.executable).toBe("npm");
      expect(resolved.useShell).toBe(false);
    }
  });
});
