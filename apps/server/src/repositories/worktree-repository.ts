import { randomUUID } from "node:crypto";
import type { Worktree } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

function rowToWorktree(row: Record<string, unknown>): Worktree {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    path: String(row.path),
    baseCommit: String(row.base_commit),
    branch: String(row.branch),
    status: String(row.status) as Worktree["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    error: row.error ? String(row.error) : undefined,
  };
}

export class WorktreeRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: {
    taskId: string;
    projectId: string;
    path: string;
    baseCommit: string;
    branch: string;
  }): Worktree {
    const now = new Date().toISOString();
    const worktree: Worktree = {
      id: randomUUID(),
      taskId: input.taskId,
      projectId: input.projectId,
      path: input.path,
      baseCommit: input.baseCommit,
      branch: input.branch,
      status: "CREATING",
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO worktrees(
          id, task_id, project_id, path, base_commit, branch, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        worktree.id,
        worktree.taskId,
        worktree.projectId,
        worktree.path,
        worktree.baseCommit,
        worktree.branch,
        worktree.status,
        worktree.createdAt,
        worktree.updatedAt,
      );

    return worktree;
  }

  updateStatus(
    id: string,
    status: Worktree["status"],
    error?: string,
  ): void {
    this.db
      .prepare(
        "UPDATE worktrees SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, error ?? null, new Date().toISOString(), id);
  }

  getByTaskId(taskId: string): Worktree | undefined {
    const row = this.db
      .prepare("SELECT * FROM worktrees WHERE task_id = ? ORDER BY created_at DESC")
      .get(taskId);
    return row ? rowToWorktree(row as unknown as Record<string, unknown>) : undefined;
  }
}
