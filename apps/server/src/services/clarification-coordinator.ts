import type {
  ClarificationQuestion,
  PendingClarification,
} from "@bugfix-harness/shared";
import type { EventBus } from "./event-bus.js";

export type ClarificationAnswers = Record<
  string,
  { answers: string[] }
>;

interface PendingEntry {
  record: PendingClarification;
  resolve: (answers: ClarificationAnswers) => void;
}

export class ClarificationCoordinator {
  private readonly pending = new Map<string, PendingEntry>();

  constructor(private readonly events: EventBus) {}

  request(input: {
    taskId: string;
    requestId: number;
    threadId: string | null;
    turnId: string | null;
    itemId: string | null;
    questions: ClarificationQuestion[];
  }): Promise<ClarificationAnswers> {
    const record: PendingClarification = {
      taskId: input.taskId,
      requestId: input.requestId,
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      questions: input.questions,
      createdAt: new Date().toISOString(),
    };

    const key = `${input.taskId}:${input.requestId}`;
    const promise = new Promise<ClarificationAnswers>((resolve) => {
      this.pending.set(key, { record, resolve });
    });

    this.events.publish({
      type: "clarification.requested",
      taskId: input.taskId,
      payload: record,
    });

    return promise;
  }

  get(taskId: string): PendingClarification | null {
    return this.findEntry(taskId)?.record ?? null;
  }

  answer(taskId: string, answers: ClarificationAnswers): boolean {
    const entry = this.findEntry(taskId);
    if (!entry) {
      return false;
    }

    this.pending.delete(`${entry.record.taskId}:${entry.record.requestId}`);
    entry.resolve(answers);
    this.events.publish({
      type: "clarification.answered",
      taskId,
      payload: { answeredAt: new Date().toISOString() },
    });
    return true;
  }

  clear(taskId: string): void {
    for (const [key, entry] of this.pending) {
      if (entry.record.taskId === taskId) {
        this.pending.delete(key);
        entry.resolve({});
      }
    }
  }

  private findEntry(taskId: string): PendingEntry | undefined {
    for (const entry of this.pending.values()) {
      if (entry.record.taskId === taskId) {
        return entry;
      }
    }
    return undefined;
  }
}
