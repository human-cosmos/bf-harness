import { AppServerRuntime } from "../src/services/app-server-runtime.js";

const runtime = new AppServerRuntime({
  cwd: process.env.SPIKE_WORKSPACE ?? process.cwd(),
  approvalMode: "decline",
  timeoutMs: 120_000,
  log: (label, value) => {
    console.log(`[runtime-smoke] ${label} ${value === undefined ? "" : JSON.stringify(value)}`);
  },
}).start();

runtime.on("notification", ({ method }) => {
  if (method === "item/agentMessage/delta") {
    process.stdout.write(runtime.getAgentText().slice(-100));
  }
});

try {
  await runtime.initialize({
    name: "bugfix-harness-server-smoke",
    title: "Bugfix Harness Server Smoke",
    version: "0.1.0",
  });
  await runtime.startThread({
    cwd: process.cwd(),
    sandbox: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ephemeral: false,
  });
  await runtime.startTurn({
    threadId: runtime.currentThreadId!,
    input: [{ type: "text", text: "Reply with exactly: RUNTIME_OK" }],
  });
  const completion = await runtime.waitForTurnCompletion();
  console.log("\n[runtime-smoke] completion", completion);
  console.log("[runtime-smoke] final-agent-text", runtime.getAgentText());
} catch (error) {
  console.error("[runtime-smoke] failed", error);
  process.exitCode = 1;
} finally {
  runtime.close();
}
