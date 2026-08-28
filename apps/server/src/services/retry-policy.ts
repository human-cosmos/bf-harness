export const MAX_AUTO_REPAIR_ROUNDS = 2;

export function canAutoRepair(retryCount: number): boolean {
  return retryCount < MAX_AUTO_REPAIR_ROUNDS;
}

export function nextValidationAction(input: {
  currentRound: number;
  sameFailure: boolean;
}): "REPAIR" | "BLOCKED" | "WAIT_FOR_ACCEPTANCE" {
  if (input.sameFailure && input.currentRound >= MAX_AUTO_REPAIR_ROUNDS) {
    return "BLOCKED";
  }
  return "REPAIR";
}
