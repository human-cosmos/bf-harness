import type { ConversationPolicy } from "@bugfix-harness/shared";
import type { ConversationApprovalRepository } from "../repositories/conversation-approval-repository.js";
import type { ConversationClarificationRepository } from "../repositories/conversation-clarification-repository.js";
import type { EventBus } from "./event-bus.js";
import { DynamicToolRegistry } from "./dynamic-tool-registry.js";
import type { RuntimeMessage } from "./app-server-runtime.js";

export type ConversationApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export interface SessionApprovalGrant {
  key: string;
  permissions?: unknown;
}

interface ApprovalWaiter {
  resolve: (decision: ConversationApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ClarificationWaiter {
  resolve: (answers: Record<string, { answers: string[] }>) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

export class ConversationInteractionCoordinator {
  private readonly approvalWaiters = new Map<string, ApprovalWaiter>();
  private readonly pendingGrants = new Map<string, SessionApprovalGrant>();
  private readonly clarificationWaiters = new Map<string, ClarificationWaiter>();

  constructor(
    private readonly conversationId: string,
    private readonly approvals: ConversationApprovalRepository,
    private readonly clarifications: ConversationClarificationRepository,
    private readonly events: EventBus,
    private readonly policy: ConversationPolicy,
    private readonly dynamicTools: DynamicToolRegistry,
    private readonly timeoutMs: number | null = null,
    private readonly sessionApprovals: Map<string, SessionApprovalGrant> = new Map(),
    private readonly onSessionApproval?: (grant: SessionApprovalGrant) => void,
  ) {}

  async handleServerRequest(message: RuntimeMessage): Promise<unknown | undefined> {
    const method = message.method ?? "";
    const params = (message.params ?? {}) as Record<string, unknown>;

    if (method === "item/commandExecution/requestApproval") {
      return this.handleCommandApproval(message.id!, params);
    }
    if (method === "item/fileChange/requestApproval") {
      return this.handleFileApproval(message.id!, params);
    }
    if (method === "item/permissions/requestApproval") {
      return this.handlePermissionsApproval(message.id!, params);
    }
    if (method === "applyPatchApproval") {
      return this.handleLegacyFileApproval(message.id!, params);
    }
    if (method === "execCommandApproval") {
      return this.handleLegacyCommandApproval(message.id!, params);
    }
    if (method === "item/tool/requestUserInput") {
      return this.handleClarification(message.id!, params);
    }
    if (method === "item/tool/call") {
      return this.handleDynamicTool(params);
    }

    return undefined;
  }

  decideApproval(approvalId: string, decision: ConversationApprovalDecision): void {
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.decision) {
      return;
    }
    this.approvals.decide(approvalId, decision);
    const waiter = this.approvalWaiters.get(approvalId);
    if (waiter) {
      this.approvalWaiters.delete(approvalId);
      if (waiter.timer !== null) {
        clearTimeout(waiter.timer);
      }
      if (decision === "acceptForSession") {
        const grant = this.pendingGrants.get(approvalId);
        if (grant) {
          this.sessionApprovals.set(grant.key, grant);
          this.onSessionApproval?.(grant);
        }
      }
      this.pendingGrants.delete(approvalId);
      waiter.resolve(decision);
    }
    this.events.publish({
      type: "conversation.approval.resolved",
      payload: { conversationId: this.conversationId, approvalId, decision },
    });
  }

  answerClarification(
    clarificationId: string,
    answers: Record<string, { answers: string[] }>,
  ): void {
    const clarification = this.clarifications.get(clarificationId);
    if (!clarification || clarification.status !== "PENDING") {
      return;
    }
    this.clarifications.answer(clarificationId, answers);
    const waiter = this.clarificationWaiters.get(clarificationId);
    if (waiter) {
      this.clarificationWaiters.delete(clarificationId);
      if (waiter.timer !== null) {
        clearTimeout(waiter.timer);
      }
      waiter.resolve(answers);
    }
    this.events.publish({
      type: "conversation.clarification.answered",
      payload: {
        conversationId: this.conversationId,
        clarificationId,
      },
    });
  }

  cancelPending(): void {
    for (const [id, waiter] of this.approvalWaiters) {
      if (waiter.timer !== null) {
        clearTimeout(waiter.timer);
      }
      this.approvals.decide(id, "cancel");
      waiter.resolve("cancel");
    }
    this.approvalWaiters.clear();
    this.pendingGrants.clear();

    for (const [id, waiter] of this.clarificationWaiters) {
      if (waiter.timer !== null) {
        clearTimeout(waiter.timer);
      }
      this.clarifications.cancel(id);
      waiter.resolve({});
    }
    this.clarificationWaiters.clear();
  }

  private async handleCommandApproval(
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<{ decision: ConversationApprovalDecision }> {
    const kind = String(params.kind ?? "command");
    const networkHost = (params.networkApprovalContext as {
      host?: string | null;
    } | null)?.host;
    const requestKind = networkHost ? "network" : kind;
    const payload = networkHost
      ? { ...params, host: networkHost }
      : params;
    const grant = this.grantFor("item/commandExecution/requestApproval", params);
    if (this.sessionApprovals.has(grant.key)) {
      return { decision: "acceptForSession" };
    }

    const decision = await this.createAndWaitApproval({
      requestId,
      method: "item/commandExecution/requestApproval",
      kind: requestKind,
      payload,
      riskLevel: networkHost ? "high" : "prompt",
      grant,
    });

    return { decision };
  }

  private async handleFileApproval(
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<{ decision: ConversationApprovalDecision }> {
    const grant = this.grantFor("item/fileChange/requestApproval", params);
    if (this.sessionApprovals.has(grant.key)) {
      return { decision: "acceptForSession" };
    }
    const decision = await this.createAndWaitApproval({
      requestId,
      method: "item/fileChange/requestApproval",
      kind: "file",
      payload: params,
      riskLevel: "prompt",
      grant,
    });
    return { decision };
  }

  private async handlePermissionsApproval(
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<{ permissions: unknown; scope: "turn" | "session" }> {
    const grant = this.grantFor("item/permissions/requestApproval", params);
    const cached = this.sessionApprovals.get(grant.key);
    if (cached) {
      return {
        permissions: cached.permissions ?? {},
        scope: "session",
      };
    }
    const decision = await this.createAndWaitApproval({
      requestId,
      method: "item/permissions/requestApproval",
      kind: "permissions",
      payload: params,
      riskLevel: "prompt",
      grant,
    });
    if (decision === "accept" || decision === "acceptForSession") {
      return {
        permissions: params.permissions ?? {},
        scope: decision === "acceptForSession" ? "session" : "turn",
      };
    }
    return { permissions: {}, scope: "turn" };
  }

  private async handleLegacyCommandApproval(
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<{ decision: unknown }> {
    const grant = this.grantFor("execCommandApproval", params);
    if (this.sessionApprovals.has(grant.key)) {
      return { decision: "approved" };
    }
    const decision = await this.createAndWaitApproval({
      requestId,
      method: "execCommandApproval",
      kind: "command",
      payload: params,
      riskLevel: "prompt",
      grant,
    });
    return {
      decision:
        decision === "accept" || decision === "acceptForSession"
          ? "approved"
          : decision === "cancel"
            ? "abort"
            : { denied: { rejection: "declined by reviewer" } },
    };
  }

  private async handleLegacyFileApproval(
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<{ decision: unknown }> {
    const grant = this.grantFor("applyPatchApproval", params);
    if (this.sessionApprovals.has(grant.key)) {
      return { decision: "approved" };
    }
    const decision = await this.createAndWaitApproval({
      requestId,
      method: "applyPatchApproval",
      kind: "file",
      payload: params,
      riskLevel: "prompt",
      grant,
    });
    return {
      decision:
        decision === "accept" || decision === "acceptForSession"
          ? "approved"
          : decision === "cancel"
            ? "abort"
            : { denied: { rejection: "declined by reviewer" } },
    };
  }

  private async createAndWaitApproval(input: {
    requestId: number;
    method: string;
    kind: string;
    payload: unknown;
    riskLevel: string;
    grant: SessionApprovalGrant;
  }): Promise<ConversationApprovalDecision> {
    const approval = this.approvals.create({
      conversationId: this.conversationId,
      codexRequestId: input.requestId,
      method: input.method,
      kind: input.kind,
      payload: input.payload,
      riskLevel: input.riskLevel,
    });

    this.events.publish({
      type: "conversation.approval.requested",
      payload: { conversationId: this.conversationId, approval },
    });
    this.pendingGrants.set(approval.id, input.grant);

    return new Promise<ConversationApprovalDecision>((resolve) => {
      const waiter: ApprovalWaiter = {
        resolve,
        timer:
          this.timeoutMs === null
            ? null
            : setTimeout(() => {
                if (this.approvalWaiters.delete(approval.id)) {
                  this.approvals.decide(approval.id, "cancel");
                  resolve("cancel");
                }
              }, this.timeoutMs),
      };
      this.approvalWaiters.set(approval.id, waiter);
    });
  }

  private grantFor(
    method: string,
    params: Record<string, unknown>,
  ): SessionApprovalGrant {
    return {
      key: this.approvalKeyFor(method, params),
      permissions: params.permissions,
    };
  }

  private approvalKeyFor(
    method: string,
    params: Record<string, unknown>,
  ): string {
    const kind = String(params.kind ?? "command");
    const networkHost = (params.networkApprovalContext as {
      host?: string | null;
    } | null)?.host;
    if (networkHost) {
      return `${method}:network:${networkHost}`;
    }
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "execCommandApproval"
    ) {
      const command = Array.isArray(params.command)
        ? params.command.map(String).join(" ")
        : String(params.command ?? "");
      return `${method}:${kind}:${String(params.cwd ?? "")}:${command}`;
    }
    if (
      method === "item/fileChange/requestApproval" ||
      method === "applyPatchApproval"
    ) {
      const path = params.path ?? params.target ?? params.grantRoot ?? "";
      const files = Array.isArray(params.files)
        ? stableSerialize(params.files)
        : "";
      return `${method}:${kind}:${String(path)}:${files}`;
    }
    if (method === "item/permissions/requestApproval") {
      return `${method}:${kind}:${stableSerialize(params.permissions ?? {})}`;
    }
    return `${method}:${kind}:${stableSerialize(params)}`;
  }

  private async handleClarification(
    requestId: number,
    params: Record<string, unknown>,
  ): Promise<{ answers: Record<string, { answers: string[] }> }> {
    const questions = params.questions ?? [];
    const clarification = this.clarifications.create({
      conversationId: this.conversationId,
      codexRequestId: requestId,
      codexTurnId: params.turnId ? String(params.turnId) : null,
      codexItemId: params.itemId ? String(params.itemId) : null,
      questions,
    });

    this.events.publish({
      type: "conversation.clarification.requested",
      payload: { conversationId: this.conversationId, clarification },
    });

    const answers = await new Promise<Record<string, { answers: string[] }>>(
      (resolve) => {
        const waiter: ClarificationWaiter = {
          resolve,
          timer:
            this.timeoutMs === null
              ? null
              : setTimeout(() => {
                  if (this.clarificationWaiters.delete(clarification.id)) {
                    this.clarifications.cancel(clarification.id);
                    resolve({});
                  }
                }, this.timeoutMs),
        };
        this.clarificationWaiters.set(clarification.id, waiter);
      },
    );
    return { answers };
  }

  private async handleDynamicTool(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.dynamicTools.call({
      threadId: params.threadId ? String(params.threadId) : undefined,
      turnId: params.turnId ? String(params.turnId) : undefined,
      callId: params.callId ? String(params.callId) : undefined,
      namespace: params.namespace ? String(params.namespace) : null,
      tool: String(params.tool ?? ""),
      arguments: params.arguments ?? {},
    });
  }
}
