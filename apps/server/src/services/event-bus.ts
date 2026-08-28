import { EventEmitter } from "node:events";

export type HarnessEvent = {
  type: string;
  taskId?: string;
  payload?: unknown;
  emittedAt: string;
};

export class EventBus {
  private readonly emitter = new EventEmitter();

  publish(event: Omit<HarnessEvent, "emittedAt">): void {
    const fullEvent: HarnessEvent = {
      ...event,
      emittedAt: new Date().toISOString(),
    };
    this.emitter.emit("event", fullEvent);
  }

  subscribe(listener: (event: HarnessEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
