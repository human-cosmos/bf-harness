import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { terminateChildTree } from "../src/services/process-guard.js";

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
});
