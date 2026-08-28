import { AgentEventRepository } from "../repositories/agent-event-repository.js";
import type { AppServerRuntime } from "./app-server-runtime.js";

export class RuntimeEventRecorder {
  private seq = 0;

  constructor(
    private readonly events: AgentEventRepository,
    private readonly taskId: string,
    private readonly workflowRunId?: string,
  ) {}

  attach(runtime: AppServerRuntime): () => void {
    const listener = ({
      method,
      params,
    }: {
      method: string;
      params: unknown;
    }) => {
      this.seq += 1;
      const data = params as Record<string, unknown>;
      this.events.append({
        taskId: this.taskId,
        workflowRunId: this.workflowRunId,
        codexThreadId: runtime.currentThreadId ?? undefined,
        codexTurnId: runtime.currentTurnId ?? undefined,
        codexItemId: data.itemId ? String(data.itemId) : undefined,
        method,
        payload: data,
        seq: this.seq,
        emittedAtMs: Date.now(),
      });
    };

    runtime.on("notification", listener);
    return () => runtime.off("notification", listener);
  }
}
