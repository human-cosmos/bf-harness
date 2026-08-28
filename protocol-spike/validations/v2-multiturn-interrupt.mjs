import { AppServerClient } from "../lib/app-server.mjs";

const WORKSPACE = process.env.SPIKE_WORKSPACE || process.cwd();
const client = new AppServerClient({
  cwd: WORKSPACE,
  approvalMode: "decline",
  timeoutMs: 120_000,
  log: (label, value) => {
    console.log(`[v2] ${label} ${value === undefined ? "" : JSON.stringify(value)}`);
  },
}).start();

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function runStructuredTurn(status) {
  await client.startTurn({
    threadId: client.currentThreadId,
    input: [
      {
        type: "text",
        text: `Return a JSON object only with status "${status}".`,
      },
    ],
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { type: "string", enum: [status] },
      },
    },
  });

  const completion = await client.waitForTurnCompletion();
  const parsed = JSON.parse(stripCodeFences(client.agentText));
  console.log(`[v2] turn-output ${JSON.stringify({ requested: status, actual: parsed })}`);

  if (parsed?.status !== status) {
    throw new Error(`expected status ${status}, got ${JSON.stringify(parsed)}`);
  }

  return completion;
}

try {
  await client.initialize({
    name: "bugfix-harness-v2-multiturn",
    title: "Bugfix Harness V2",
    version: "0.1.0",
  });

  await client.startThread({
    cwd: WORKSPACE,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ephemeral: false,
  });

  const first = await runStructuredTurn("FIRST");
  const second = await runStructuredTurn("SECOND");
  console.log("[v2] multi-turn PASS", {
    firstStatus: first.turn?.status,
    secondStatus: second.turn?.status,
  });

  const interruptTurn = await client.startTurn({
    threadId: client.currentThreadId,
    input: [
      {
        type: "text",
        text:
          "Count from 1 to 10000, one number per line. Do not stop early.",
      },
    ],
  });

  setTimeout(() => {
    client.interruptCurrentTurn().catch((error) => {
      console.error(`[v2] interrupt failed: ${error.message}`);
    });
  }, 100);

  const interrupted = await client.waitForTurnCompletion({ timeoutMs: 60_000 });
  console.log("[v2] interrupt-result", {
    turnId: interruptTurn.turn?.id,
    status: interrupted.turn?.status,
  });

  if (interrupted.turn?.status !== "interrupted") {
    throw new Error(
      `expected turn status "interrupted", got ${interrupted.turn?.status}`,
    );
  }

  console.log("[v2] interrupt PASS");
} catch (error) {
  console.error(`[v2] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  client.close();
}
