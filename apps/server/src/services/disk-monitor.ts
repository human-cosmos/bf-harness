import { statfsSync } from "node:fs";
import { MAX_TOTAL_DATA_BYTES, WARN_RATIO } from "./retention.js";

export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedRatio: number;
  warn: boolean;
}

export class DiskMonitor {
  check(path: string): DiskUsage {
    const stats = statfsSync(path);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const freeBytes = Number(stats.bavail) * blockSize;
    const usedBytes = totalBytes - freeBytes;
    const usedRatio = totalBytes > 0 ? usedBytes / totalBytes : 0;

    return {
      path,
      totalBytes,
      freeBytes,
      usedBytes,
      usedRatio,
      warn: usedBytes >= MAX_TOTAL_DATA_BYTES * WARN_RATIO,
    };
  }
}
