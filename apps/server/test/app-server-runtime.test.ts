import { describe, expect, it } from "vitest";
import { AppServerRuntime } from "../src/services/app-server-runtime.js";

describe("AppServerRuntime", () => {
  it("rejects initialization when the codex binary cannot be spawned", async () => {
    const runtime = new AppServerRuntime({
      codexBin: "/definitely/not/a/real/codex-binary",
    }).start();

    await expect(
      runtime.initialize({
        name: "bugfix-harness",
        title: "Bugfix Harness",
        version: "0.1.0",
      }),
    ).rejects.toThrow();

    runtime.close();
  });
});
