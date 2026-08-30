export const MAX_AUTO_REPAIR_ROUNDS = 2;

export interface ValidationFailureRun {
  id: string;
  createdAt: string;
  failures: Array<Record<string, unknown>>;
}

export function groupFailedValidationRuns(
  rows: Array<Record<string, unknown>>,
): ValidationFailureRun[] {
  const runs = new Map<
    string,
    { createdAt: string; failures: Array<Record<string, unknown>> }
  >();

  for (const row of rows) {
    const status = String(row.status ?? "");
    if (status !== "failed" && status !== "timeout") {
      continue;
    }

    const runId = String(
      row.validation_run_id ?? `legacy-${String(row.id ?? "unknown")}`,
    );
    const createdAt = String(row.created_at ?? new Date(0).toISOString());
    const existing = runs.get(runId);
    if (existing) {
      existing.failures.push(row);
      if (createdAt < existing.createdAt) {
        existing.createdAt = createdAt;
      }
    } else {
      runs.set(runId, { createdAt, failures: [row] });
    }
  }

  return [...runs.entries()]
    .map(([id, value]) => ({
      id,
      createdAt: value.createdAt,
      failures: value.failures,
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function validationFailureSignature(
  failures: Array<Record<string, unknown>>,
): string {
  return failures
    .map((failure) => ({
      commandId: String(failure.command_id ?? ""),
      status: String(failure.status ?? ""),
      exitCode:
        failure.exit_code === null || failure.exit_code === undefined
          ? null
          : Number(failure.exit_code),
      stderr: String(failure.stderr ?? "").trim(),
      stdout: String(failure.stdout ?? "").trim().slice(0, 1_000),
    }))
    .sort((left, right) =>
      `${left.commandId}:${left.status}`.localeCompare(
        `${right.commandId}:${right.status}`,
      ),
    )
    .map((item) => JSON.stringify(item))
    .join("|");
}

export function canAutoRepair(
  retryCount: number,
  maxAutoRepairRounds: number = MAX_AUTO_REPAIR_ROUNDS,
): boolean {
  return retryCount < maxAutoRepairRounds;
}

export function nextValidationAction(input: {
  currentRound: number;
  sameFailure: boolean;
  maxAutoRepairRounds?: number;
}): "REPAIR" | "BLOCKED" | "WAIT_FOR_ACCEPTANCE" {
  const maxRounds = input.maxAutoRepairRounds ?? MAX_AUTO_REPAIR_ROUNDS;
  if (input.sameFailure && input.currentRound >= maxRounds) {
    return "BLOCKED";
  }
  return "REPAIR";
}
