import { randomUUID } from "node:crypto";
import type {
  Conversation,
  ConversationPolicy,
  ConversationSettings,
  ConversationStatus,
  UpdateConversationInput,
} from "@bugfix-harness/shared";
import {
  DEFAULT_CONVERSATION_POLICY,
  DEFAULT_CONVERSATION_SETTINGS,
} from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

export interface ConversationCreateInput {
  projectId: string;
  title: string;
  policy?: ConversationPolicy;
  settings?: ConversationSettings;
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    codexThreadId: row.codex_thread_id ? String(row.codex_thread_id) : null,
    status: String(row.status) as ConversationStatus,
    policy: {
      sandboxMode: String(row.sandbox_mode) as ConversationPolicy["sandboxMode"],
      networkAccess: Number(row.network_access) === 1,
      approvalPolicy: String(
        row.approval_policy,
      ) as ConversationPolicy["approvalPolicy"],
      approvalsReviewer: String(
        row.approvals_reviewer,
      ) as ConversationPolicy["approvalsReviewer"],
      allowGitWrites: Number(row.allow_git_writes) === 1,
    },
    settings: {
      model: row.model ? String(row.model) : undefined,
      reasoningEffort: row.reasoning_effort
        ? String(row.reasoning_effort)
        : undefined,
      baseInstructions: row.base_instructions
        ? String(row.base_instructions)
        : undefined,
      developerInstructions: row.developer_instructions
        ? String(row.developer_instructions)
        : undefined,
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ConversationRepository {
  constructor(private readonly db: AppDatabase) {}

  list(projectId?: string): Conversation[] {
    if (projectId) {
      return this.db
        .prepare(
          "SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC",
        )
        .all(projectId)
        .map((row) => rowToConversation(row as unknown as Record<string, unknown>));
    }

    return this.db
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all()
      .map((row) => rowToConversation(row as unknown as Record<string, unknown>));
  }

  get(id: string): Conversation | undefined {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id);
    return row
      ? rowToConversation(row as unknown as Record<string, unknown>)
      : undefined;
  }

  create(input: ConversationCreateInput): Conversation {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title,
      codexThreadId: null,
      status: "IDLE",
      policy: input.policy
        ? { ...input.policy }
        : { ...DEFAULT_CONVERSATION_POLICY },
      settings: input.settings
        ? { ...input.settings }
        : { ...DEFAULT_CONVERSATION_SETTINGS },
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO conversations(
          id, project_id, title, codex_thread_id, status, sandbox_mode,
          network_access, approval_policy, approvals_reviewer, allow_git_writes,
          model, reasoning_effort, base_instructions, developer_instructions,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        conversation.id,
        conversation.projectId,
        conversation.title,
        conversation.codexThreadId,
        conversation.status,
        conversation.policy.sandboxMode,
        conversation.policy.networkAccess ? 1 : 0,
        conversation.policy.approvalPolicy,
        conversation.policy.approvalsReviewer,
        conversation.policy.allowGitWrites ? 1 : 0,
        conversation.settings.model ?? null,
        conversation.settings.reasoningEffort ?? null,
        conversation.settings.baseInstructions ?? null,
        conversation.settings.developerInstructions ?? null,
        conversation.createdAt,
        conversation.updatedAt,
      );

    return conversation;
  }

  update(id: string, input: UpdateConversationInput): Conversation | undefined {
    const existing = this.get(id);
    if (!existing) {
      return undefined;
    }

    const next: Conversation = {
      ...existing,
      title: input.title ?? existing.title,
      policy: input.policy ?? existing.policy,
      settings: input.settings ?? existing.settings,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `UPDATE conversations SET
          title = ?,
          sandbox_mode = ?,
          network_access = ?,
          approval_policy = ?,
          approvals_reviewer = ?,
          allow_git_writes = ?,
          model = ?,
          reasoning_effort = ?,
          base_instructions = ?,
          developer_instructions = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        next.title,
        next.policy.sandboxMode,
        next.policy.networkAccess ? 1 : 0,
        next.policy.approvalPolicy,
        next.policy.approvalsReviewer,
        next.policy.allowGitWrites ? 1 : 0,
        next.settings.model ?? null,
        next.settings.reasoningEffort ?? null,
        next.settings.baseInstructions ?? null,
        next.settings.developerInstructions ?? null,
        next.updatedAt,
        id,
      );

    return next;
  }

  updateThreadId(id: string, codexThreadId: string): void {
    this.db
      .prepare(
        "UPDATE conversations SET codex_thread_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(codexThreadId, new Date().toISOString(), id);
  }

  updateStatus(id: string, status: ConversationStatus): void {
    this.db
      .prepare(
        "UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, new Date().toISOString(), id);
  }

  delete(id: string): boolean {
    this.db.exec("BEGIN");
    try {
      for (const table of [
        "conversation_events",
        "conversation_approvals",
        "conversation_clarifications",
        "conversation_items",
        "conversation_turns",
      ]) {
        this.db
          .prepare(`DELETE FROM ${table} WHERE conversation_id = ?`)
          .run(id);
      }
      const result = this.db
        .prepare("DELETE FROM conversations WHERE id = ?")
        .run(id);
      this.db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
