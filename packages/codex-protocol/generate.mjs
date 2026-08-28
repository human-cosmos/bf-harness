import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const codexBin = process.env.CODEX_BIN || "codex-harness";
const tsOut = resolve(packageRoot, "src/generated");
const jsonOut = resolve(packageRoot, "schema");

mkdirSync(tsOut, { recursive: true });
mkdirSync(jsonOut, { recursive: true });

const ts = spawnSync(
  codexBin,
  ["app-server", "generate-ts", "--out", tsOut],
  { encoding: "utf8" },
);

const json = spawnSync(
  codexBin,
  ["app-server", "generate-json-schema", "--out", jsonOut],
  { encoding: "utf8" },
);

if (ts.status !== 0) {
  console.error(ts.stderr || ts.stdout);
  process.exit(ts.status ?? 1);
}

if (json.status !== 0) {
  console.error(json.stderr || json.stdout);
  process.exit(json.status ?? 1);
}

console.log(`Generated Codex app-server protocol into ${tsOut}`);
console.log(`Generated JSON Schema into ${jsonOut}`);
