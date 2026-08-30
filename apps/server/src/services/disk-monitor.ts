import { statfsSync } from "node:fs";
export interface DiskUsage {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedRatio: number;
  warn: boolean;
}

export class DiskMonitor {
  private readonly totalDataLimitBytes: number;
  private readonly warnRatio: number;

  constructor(
    options: {
      totalDataLimitBytes?: number;
      warnRatio?: number;
    } = {},
  ) {
    this.totalDataLimitBytes = options.totalDataLimitBytes ?? 5 * 1024 * 1024 * 1024;
    this.warnRatio = options.warnRatio ?? 0.8;
  }

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
      warn: usedBytes >= this.totalDataLimitBytes * this.warnRatio,
    };
  }
}
