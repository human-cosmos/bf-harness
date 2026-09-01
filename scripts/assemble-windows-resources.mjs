import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(repoRoot, "build");
const serverBundleDir = join(repoRoot, "apps", "server", "dist-desktop");
const webDistDir = join(repoRoot, "apps", "web", "dist");
const nodeExe = process.execPath;
const home = homedir();
const codexSourceDir =
  process.env.CODEX_BUNDLE_DIR ??
  join(home, ".codex", "plugins", ".plugin-appserver");
const gitSourceDir =
  process.env.GIT_BUNDLE_DIR ??
  join(
    home,
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "native",
    "git",
  );

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function requireDir(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function runPnpm(args) {
  const pnpmCli = process.env.npm_execpath;
  const useCliFile =
    pnpmCli &&
    (pnpmCli.endsWith(".cjs") ||
      pnpmCli.endsWith(".js") ||
      pnpmCli.endsWith(".mjs"));
  const command = useCliFile
    ? process.execPath
    : pnpmCli || (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  const commandArgs = useCliFile ? [pnpmCli, ...args] : args;
  return execFileSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
}

function runNpm(args) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

requireFile(nodeExe, "Node executable");
requireFile(join(webDistDir, "index.html"), "Web build");
requireDir(codexSourceDir, "Codex bundle directory");
requireDir(gitSourceDir, "Git bundle directory");

rmSync(buildDir, { recursive: true, force: true });
rmSync(serverBundleDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

const codexTarget = join(buildDir, "codex");
const codexResourcesDir = join(codexTarget, "codex-resources");
mkdirSync(codexTarget, { recursive: true });
mkdirSync(codexResourcesDir, { recursive: true });

for (const file of ["codex.exe", "codex-code-mode-host.exe"]) {
  const source = join(codexSourceDir, file);
  requireFile(source, `Codex binary ${file}`);
  copyFileSync(source, join(codexTarget, file));
}

for (const file of [
  "codex-windows-sandbox-setup.exe",
  "codex-command-runner.exe",
]) {
  const source = join(codexSourceDir, file);
  requireFile(source, `Codex helper ${file}`);
  copyFileSync(source, join(codexResourcesDir, file));
}

const codexExePath = join(codexTarget, "codex.exe");
const protocolGenerateScript = join(
  repoRoot,
  "packages",
  "codex-protocol",
  "generate.mjs",
);
if (!existsSync(protocolGenerateScript)) {
  throw new Error(`Protocol generation script not found: ${protocolGenerateScript}`);
}
execFileSync(codexExePath, ["--version"], {
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
});

const originalCodexBin = process.env.CODEX_BIN;
try {
  process.env.CODEX_BIN = codexExePath;
  execFileSync(process.execPath, [protocolGenerateScript], {
    cwd: dirname(protocolGenerateScript),
    env: process.env,
    stdio: "inherit",
  });
} finally {
  if (originalCodexBin === undefined) {
    delete process.env.CODEX_BIN;
  } else {
    process.env.CODEX_BIN = originalCodexBin;
  }
}

runPnpm(["--filter", "@bugfix-harness/server", "build:desktop"]);

requireFile(join(serverBundleDir, "index.cjs"), "Server bundle");

const nodeTarget = join(buildDir, "node");
mkdirSync(nodeTarget, { recursive: true });
copyFileSync(nodeExe, join(nodeTarget, "node.exe"));

const serverTarget = join(buildDir, "server");
mkdirSync(serverTarget, { recursive: true });
for (const file of ["index.cjs", "index.cjs.map"]) {
  const source = join(serverBundleDir, file);
  if (existsSync(source)) {
    copyFileSync(source, join(serverTarget, file));
  }
}
const serverVendorDir = join(serverTarget, "vendor");
mkdirSync(serverVendorDir, { recursive: true });
writeFileSync(
  join(serverVendorDir, "package.json"),
  JSON.stringify(
    {
      name: "bugfix-harness-desktop-server-vendor",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: {
        fastify: "^5.4.0",
        "@fastify/websocket": "^11.2.0",
        zod: "^3.25.76",
      },
    },
    null,
    2,
  ),
);
runNpm([
  "install",
  "--prefix",
  serverVendorDir,
  "--omit=dev",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
]);
renameSync(
  join(serverVendorDir, "node_modules"),
  join(serverVendorDir, "deps"),
);
cpSync(webDistDir, join(serverTarget, "web"), {
  recursive: true,
  dereference: true,
});

cpSync(gitSourceDir, join(buildDir, "git"), {
  recursive: true,
  dereference: true,
});

requireFile(join(buildDir, "node", "node.exe"), "Packaged node.exe");
requireFile(join(buildDir, "server", "index.cjs"), "Packaged server bundle");
requireFile(join(buildDir, "server", "web", "index.html"), "Packaged web root");
requireDir(
  join(buildDir, "server", "vendor", "deps", "fastify"),
  "Packaged server dependencies",
);
requireFile(join(buildDir, "codex", "codex.exe"), "Packaged codex.exe");
requireFile(
  join(buildDir, "codex", "codex-code-mode-host.exe"),
  "Packaged codex-code-mode-host.exe",
);
requireFile(
  join(buildDir, "codex", "codex-resources", "codex-windows-sandbox-setup.exe"),
  "Packaged codex sandbox setup",
);
requireFile(
  join(buildDir, "codex", "codex-resources", "codex-command-runner.exe"),
  "Packaged codex command runner",
);
requireFile(join(buildDir, "git", "cmd", "git.exe"), "Packaged git.exe");

console.log(`Assembled Windows resources into ${buildDir}`);
