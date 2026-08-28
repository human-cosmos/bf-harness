import { AppServerClient } from "../lib/app-server.mjs";

const WORKSPACE = process.env.SPIKE_WORKSPACE || process.cwd();
let firstClient;
let secondClient;

async function startClient(name) {
  const client = new AppServerClient({
    cwd: WORKSPACE,
    approvalMode: "decline",
    timeoutMs: 120_000,
    log: (label, value) => {
      console.log(`[v4:${name}] ${label} ${value === undefined ? "" : JSON.stringify(value)}`);
    },
  }).start();

  await client.initialize({
    name,
    title: "Bugfix Harness V4",
    version: "0.1.0",
  });
  return client;
}

try {
  firstClient = await startClient("first");
  await firstClient.startThread({
    cwd: WORKSPACE,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ephemeral: false,
  });

  const threadId = firstClient.currentThreadId;
  await firstClient.startTurn({
    threadId,
    input: [{ type: "text", text: "Reply with exactly: V4_OK" }],
  });
  const firstCompletion = await firstClient.waitForTurnCompletion();
  const turnId = firstCompletion.turn?.id;
  console.log("[v4] first-run", { threadId, turnId });
  firstClient.close();
  await new Promise((resolve) => setTimeout(resolve, 500));

  secondClient = await startClient("second");
  const read = await secondClient.rpc("thread/read", {
    threadId,
    includeTurns: true,
  });
  const loaded = await secondClient.rpc("thread/loaded/list", {});
  const turns = await secondClient.rpc("thread/turns/list", { threadId });
  const items = await secondClient.rpc("thread/items/list", { threadId });

  const recovered = read.thread?.id === threadId;
  const hasTurn = turns.data?.some((turn) => turn.id === turnId) ?? false;
  const hasItem = (items.data?.length ?? 0) > 0;
  const notLoaded = !(loaded.data ?? []).includes(threadId);

  console.log("[v4] recovery-evidence", {
    recovered,
    hasTurn,
    hasItem,
    notLoaded,
    loadedThreads: loaded.data ?? [],
  });

  if (recovered && hasTurn && hasItem && notLoaded) {
    console.log("[v4] PASS");
  } else {
    console.error("[v4] FAILED");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[v4] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  firstClient?.close();
  secondClient?.close();
}
