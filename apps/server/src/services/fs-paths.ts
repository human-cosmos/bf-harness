import { existsSync, realpathSync } from "node:fs";

export function resolveLongPath(path: string): string {
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
