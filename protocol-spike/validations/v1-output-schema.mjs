import { AppServerClient } from "../lib/app-server.mjs";

const WORKSPACE = process.env.SPIKE_WORKSPACE || process.cwd();
const client = new AppServerClient({
  cwd: WORKSPACE,
  approvalMode: "decline",
  timeoutMs: 120_000,
  log: (label, value) => {
    console.log(`[v1] ${label} ${value === undefined ? "" : JSON.stringify(value)}`);
  },
}).start();

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "message"],
  properties: {
    status: { type: "string", enum: ["OK"] },
    message: { type: "string" },
  },
};

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

try {
  await client.initialize({
    name: "bugfix-harness-v1-output-schema",
    title: "Bugfix Harness V1",
    version: "0.1.0",
  });

  await client.startThread({
    cwd: WORKSPACE,
    sandbox: "read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    ephemeral: false,
  });

  await client.startTurn({
    threadId: client.currentThreadId,
    input: [
      {
        type: "text",
        text: 'Return a JSON object only with status "OK" and message "v1-passed".',
      },
    ],
    outputSchema,
  });

  const completion = await client.waitForTurnCompletion();
  const raw = client.agentText;
  console.log(`[v1] raw-output ${raw}`);

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch {
    console.error("[v1] FAILED: final agent message was not valid JSON");
    process.exitCode = 1;
    client.close();
  }

  if (parsed?.status === "OK" && parsed?.message === "v1-passed") {
    console.log("[v1] PASS", {
      turnStatus: completion?.turn?.status,
      threadId: client.currentThreadId,
      turnId: client.currentTurnId,
    });
  } else {
    console.error("[v1] FAILED: unexpected structured output", parsed);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[v1] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  client.close();
}
