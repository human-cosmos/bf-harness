import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerRuntime } from "../src/services/app-server-runtime.js";

describe("AppServerRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("times out a turn only after no activity", async () => {
    vi.useFakeTimers();
    const runtime = new AppServerRuntime();
    (runtime as unknown as { resetTurnClock: () => void }).resetTurnClock();

    const completion = runtime.waitForTurnCompletion({
      idleTimeoutMs: 100,
      maxTimeoutMs: null,
    });

    await vi.advanceTimersByTimeAsync(60);
    (runtime as unknown as {
      handleMessage: (message: unknown) => void;
    }).handleMessage({
      method: "item/agentMessage/delta",
      params: { delta: "working" },
    });
    await vi.advanceTimersByTimeAsync(60);
    (runtime as unknown as {
      turnCompletions: Array<{ turn: { id: string; status: string } }>;
    }).turnCompletions.push({ turn: { id: "turn-1", status: "completed" } });
    await vi.advanceTimersByTimeAsync(50);

    await expect(completion).resolves.toEqual({
      turn: { id: "turn-1", status: "completed" },
    });
  });

  it("pauses the idle timeout while a server request is waiting", async () => {
    vi.useFakeTimers();
    const runtime = new AppServerRuntime();
    runtime.send = () => {};
    (runtime as unknown as { resetTurnClock: () => void }).resetTurnClock();

    let releaseServerRequest: (value: unknown) => void = () => {};
    runtime.onServerRequest = () =>
      new Promise((resolve) => {
        releaseServerRequest = resolve;
      });

    const serverRequest = (
      runtime as unknown as {
        handleServerRequest: (message: unknown) => Promise<void>;
      }
    ).handleServerRequest({
      method: "item/commandExecution/requestApproval",
      id: 1,
      params: { command: "npm test" },
    });
    const completion = runtime.waitForTurnCompletion({
      idleTimeoutMs: 50,
      maxTimeoutMs: null,
    });

    await vi.advanceTimersByTimeAsync(200);
    releaseServerRequest({ decision: "accept" });
    await serverRequest;
    (runtime as unknown as {
      turnCompletions: Array<{ turn: { id: string; status: string } }>;
    }).turnCompletions.push({ turn: { id: "turn-2", status: "completed" } });
    await vi.advanceTimersByTimeAsync(50);

    await expect(completion).resolves.toEqual({
      turn: { id: "turn-2", status: "completed" },
    });
  });
});
