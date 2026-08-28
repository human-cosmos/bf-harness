# Protocol Spike

Minimal runnable check that the local Harness can drive `codex-harness app-server --stdio`.

## What it proves

- start a long-lived App Server child process over stdio
- complete the `initialize` / `initialized` handshake
- create a persistent Codex Thread with a read-only sandbox
- start a Turn with structured user input
- receive streaming App Server notifications
- automatically answer approval requests (declines by default)
- exit after `turn/completed`

## Requirements

- Node.js 22+
- `codex-harness` on `PATH`

The previous setup already built and symlinked the binary as `codex-harness`.

## Run

```bash
cd /Users/zed-mac/Documents/projects/bugfix-harness/protocol-spike
npm run spike "Reply with exactly: SPIKE_OK"
```

Useful overrides:

```bash
CODEX_BIN=/path/to/codex \
SPIKE_WORKSPACE=/path/to/repo \
SPIKE_TIMEOUT_MS=60000 \
npm run spike "Run only a safe read-only check and report OK"
```

By default the spike rejects every App Server approval request. This is intentional for a smoke test and avoids executing any command or file change.
