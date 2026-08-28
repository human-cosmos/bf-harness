import { randomUUID } from "node:crypto";
import type {
  BugfixTask,
  RepairPlan,
  TaskContract,
} from "@bugfix-harness/shared";
import type { DiffResult } from "./diff-service.js";
import type { ValidationOutcome } from "./validation-runner.js";

export interface DeliveryReport {
  id: string;
  taskId: string;
  createdAt: string;
  taskGoal: string;
  rootCause: string;
  evidence: string[];
  implementation: string;
  modifiedFiles: string[];
  acceptanceChecklist: Array<{ criterion: string }>;
  validationResults: Array<{
    commandId: string;
    command: string[];
    status: string;
    exitCode: number | null;
  }>;
  knownRisks: string[];
  unverifiedItems: string[];
  recommendedReviewLocations: string[];
  diff: DiffResult;
}

export class DeliveryReportService {
  build(input: {
    task: BugfixTask;
    contract: TaskContract;
    plan: RepairPlan;
    diff: DiffResult;
    validationResults: ValidationOutcome[];
  }): DeliveryReport {
    return {
      id: randomUUID(),
      taskId: input.task.id,
      createdAt: new Date().toISOString(),
      taskGoal: input.contract.goal,
      rootCause: input.plan.rootCauseHypothesis,
      evidence: input.plan.evidence,
      implementation: input.plan.fixStrategy,
      modifiedFiles: input.diff.files.map((file) => file.path),
      acceptanceChecklist: input.contract.acceptanceCriteria.map((criterion) => ({
        criterion,
      })),
      validationResults: input.validationResults.map((result) => ({
        commandId: result.command.id,
        command: result.command.command,
        status: result.status,
        exitCode: result.exitCode,
      })),
      knownRisks: input.plan.risks,
      unverifiedItems: input.plan.openQuestions,
      recommendedReviewLocations: input.plan.proposedFiles,
      diff: input.diff,
    };
  }
}
