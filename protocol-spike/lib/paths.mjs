import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveLongPath(path) {
  if (!path) {
    return path;
  }
  try {
    if (!existsSync(path)) {
      return path;
    }
    const resolver = realpathSync.native ?? realpathSync;
    return resolver(path);
  } catch {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  }
}

export function makeSpikeScratch(prefix) {
  const scratchRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../.tmp-e2e",
  );
  mkdirSync(scratchRoot, { recursive: true });
  return resolveLongPath(mkdtempSync(join(scratchRoot, prefix)));
}

export function removeScratch(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch {
    // Codex or git may still hold files on Windows; leave for later cleanup.
  }
}
