import { AppServerRuntime } from "../src/services/app-server-runtime.js";

const runtime = new AppServerRuntime({
  cwd: process.cwd(),
  approvalMode: "decline",
  timeoutMs: 30_000,
}).start();

try {
  await runtime.initialize({
    name: "bugfix-harness-crash-smoke",
    title: "Bugfix Harness Crash Smoke",
    version: "0.1.0",
  });
  await runtime.startThread({
    cwd: process.cwd(),
    sandbox: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ephemeral: false,
  });
  const turnPromise = (async () => {
    await runtime.startTurn({
      threadId: runtime.currentThreadId!,
      input: [
        {
          type: "text",
          text: "Count from 1 to 10000, one number per line.",
        },
      ],
    });
    return runtime.waitForTurnCompletion();
  })();

  await new Promise((resolve) => setTimeout(resolve, 500));
  runtime.close();

  let terminated = false;
  try {
    await turnPromise;
  } catch (error) {
    terminated = (error as Error).message.includes("exited before turn completion");
  }

  if (terminated) {
    console.log("CRASH_RECOVERY_OK", { reason: "runtime exit detected" });
  } else {
    console.error("CRASH_RECOVERY_FAILED", { terminated });
    process.exitCode = 1;
  }
} finally {
  runtime.close();
}
