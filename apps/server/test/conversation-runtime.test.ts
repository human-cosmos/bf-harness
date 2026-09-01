import { describe, expect, it } from "vitest";
import { AppServerRuntime } from "../src/services/app-server-runtime.js";

describe("conversation AppServerRuntime extensions", () => {
  it("maps history and utility calls to the expected app-server methods", async () => {
    const runtime = new AppServerRuntime();
    const calls: Array<{ method: string; params: unknown }> = [];
    runtime.rpc = async (method: string, params: unknown) => {
      calls.push({ method, params });
      return {};
    };

    await runtime.readThread("thread-1", true);
    await runtime.listTurns("thread-1", { limit: 10 });
    await runtime.listItems("thread-1", { turnId: "turn-1" });
    await runtime.forkThread("thread-1", { lastTurnId: "turn-2" });
    await runtime.archiveThread("thread-1");
    await runtime.setThreadName("thread-1", "新对话");
    await runtime.compactThread("thread-1");
    await runtime.listModels({ limit: 20 });
    await runtime.fuzzyFileSearch({ cwd: "/repo", query: "app.ts" });
    await runtime.steerTurn("thread-1", "turn-1", [
      { type: "text", text: "继续" },
    ]);

    expect(calls.map((call) => call.method)).toEqual([
      "thread/read",
      "thread/turns/list",
      "thread/turns/items/list",
      "thread/fork",
      "thread/archive",
      "thread/name/set",
      "thread/compact/start",
      "model/list",
      "fuzzyFileSearch",
      "turn/steer",
    ]);
    expect(calls[2].params).toMatchObject({ turnId: "turn-1" });
    expect(calls[8].params).toMatchObject({ query: "app.ts" });
  });

  it("falls back to thread/items/list when official Codex method is unknown", async () => {
    const runtime = new AppServerRuntime();
    const methods: string[] = [];
    runtime.rpc = async (method: string) => {
      methods.push(method);
      if (method === "thread/turns/items/list") {
        throw new Error(
          'thread/turns/items/list: {"code":-32600,"message":"unknown variant `thread/turns/items/list`"}',
        );
      }
      return { data: [] };
    };

    await runtime.listItems("thread-1", { turnId: "turn-1" });
    expect(methods).toEqual(["thread/turns/items/list", "thread/items/list"]);
  });

  it("passes model, effort and sandbox policy through startTurn", async () => {
    const runtime = new AppServerRuntime();
    let received: Record<string, unknown> = {};
    runtime.rpc = async (_method: string, params: unknown) => {
      received = params as Record<string, unknown>;
      return {};
    };

    await runtime.startTurn({
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }],
      model: "gpt-test",
      effort: "high",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/repo"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });

    expect(received).toMatchObject({
      threadId: "thread-1",
      model: "gpt-test",
      effort: "high",
    });
    expect(received?.sandboxPolicy).toMatchObject({ type: "workspaceWrite" });
  });
});
