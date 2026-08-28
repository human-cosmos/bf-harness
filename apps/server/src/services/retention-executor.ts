import { AgentEventRepository } from "../repositories/agent-event-repository.js";

export const DEFAULT_MAX_EVENTS_PER_TASK = 10_000;

export class RetentionExecutor {
  constructor(
    private readonly events: AgentEventRepository,
    private readonly maxEvents = DEFAULT_MAX_EVENTS_PER_TASK,
  ) {}

  pruneTaskEvents(taskId: string): number {
    return this.events.pruneToRecent(taskId, this.maxEvents);
  }

  taskEventSummary(taskId: string) {
    return {
      taskId,
      currentEvents: this.events.countByTask(taskId),
      maxEvents: this.maxEvents,
      exceeded: this.events.countByTask(taskId) > this.maxEvents,
    };
  }
}
