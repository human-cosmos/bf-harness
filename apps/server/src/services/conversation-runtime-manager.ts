import type { Conversation } from "@bugfix-harness/shared";
import {
  AppServerRuntime,
  type RuntimeMessage,
} from "./app-server-runtime.js";

export interface ConversationRuntimeOptions {
  codexBin?: string;
  getCodexBin?: () => string;
  onServerRequest?: (message: RuntimeMessage) => Promise<unknown | undefined>;
  onThreadStarted?: (conversationId: string, threadId: string) => void;
}

export class ConversationRuntimeManager {
  private readonly runtimes = new Map<string, AppServerRuntime>();

  constructor(private readonly options: ConversationRuntimeOptions = {}) {}

  get(conversationId: string): AppServerRuntime | undefined {
    return this.runtimes.get(conversationId);
  }

  async getOrCreate(
    conversationId: string,
    conversation: Conversation,
    projectRoot: string,
  ): Promise<AppServerRuntime> {
    const existing = this.runtimes.get(conversationId);
    if (existing) {
      return existing;
    }

    const runtime = new AppServerRuntime({
      codexBin:
        this.options.getCodexBin?.() ??
        this.options.codexBin ??
        process.env.CODEX_BIN,
      cwd: projectRoot,
      approvalMode: "decline",
      turnIdleTimeoutMs: Number(
        process.env.BUGFIX_HARNESS_CONVERSATION_TIMEOUT_MS ?? 600_000,
      ),
    }).start();

    if (this.options.onServerRequest) {
      runtime.onServerRequest = async (message) => {
        const result = await this.options.onServerRequest!(message);
        return result;
      };
    }

    await runtime.initialize({
      name: "bugfix-harness",
      title: "Bugfix Harness Conversation",
      version: "0.2.0",
    });

    const approvalPolicy = conversation.policy.approvalPolicy;
    const approvalsReviewer = conversation.policy.approvalsReviewer;

    if (conversation.codexThreadId) {
      await runtime.resumeThread(conversation.codexThreadId, {
        approvalPolicy,
        approvalsReviewer,
        baseInstructions: conversation.settings.baseInstructions,
        developerInstructions: conversation.settings.developerInstructions,
      });
    } else {
      await runtime.startThread({
        cwd: projectRoot,
        sandbox: conversation.policy.sandboxMode,
        approvalPolicy,
        approvalsReviewer,
        baseInstructions: conversation.settings.baseInstructions,
        developerInstructions: conversation.settings.developerInstructions,
      });
    }

    const threadId = runtime.currentThreadId;
    if (threadId) {
      this.options.onThreadStarted?.(conversationId, threadId);
    }

    this.runtimes.set(conversationId, runtime);
    return runtime;
  }

  async interrupt(conversationId: string): Promise<void> {
    const runtime = this.runtimes.get(conversationId);
    if (!runtime) return;
    if (runtime.currentThreadId && runtime.currentTurnId) {
      try {
        await runtime.interrupt(runtime.currentThreadId, runtime.currentTurnId);
      } catch {
        // Best effort.
      }
    }
    runtime.close();
    this.runtimes.delete(conversationId);
  }

  close(conversationId: string): void {
    const runtime = this.runtimes.get(conversationId);
    if (!runtime) return;
    runtime.close();
    this.runtimes.delete(conversationId);
  }

  closeAll(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.close();
    }
    this.runtimes.clear();
  }

  listActiveConversationIds(): string[] {
    return [...this.runtimes.keys()];
  }
}
