import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(packageRoot, "dist-desktop");
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  outfile: resolve(outdir, "index.cjs"),
  sourcemap: true,
  external: ["fastify", "@fastify/websocket", "zod"],
});

console.log(`Built desktop server bundle into ${outdir}`);
