export const MAX_TASK_LOG_BYTES = 100 * 1024 * 1024;
export const MAX_TOTAL_DATA_BYTES = 5 * 1024 * 1024 * 1024;
export const WARN_RATIO = 0.8;

export function shouldWarnTotalData(totalBytes: number): boolean {
  return totalBytes >= MAX_TOTAL_DATA_BYTES * WARN_RATIO;
}

export function exceedsTaskLogLimit(bytes: number): boolean {
  return bytes > MAX_TASK_LOG_BYTES;
}

export function retentionSummary(input: {
  taskLogBytes: number;
  totalDataBytes: number;
}) {
  return {
    taskLogBytes: input.taskLogBytes,
    taskLogLimitBytes: MAX_TASK_LOG_BYTES,
    taskLogExceeded: exceedsTaskLogLimit(input.taskLogBytes),
    totalDataBytes: input.totalDataBytes,
    totalDataLimitBytes: MAX_TOTAL_DATA_BYTES,
    totalDataWarn: shouldWarnTotalData(input.totalDataBytes),
  };
}
