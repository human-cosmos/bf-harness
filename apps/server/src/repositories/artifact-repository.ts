import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import { redactObject } from "../services/redaction.js";

export class ArtifactRepository {
  constructor(private readonly db: AppDatabase) {}

  save(input: {
    taskId: string;
    kind: string;
    path: string;
    metadata: unknown;
  }) {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO artifacts(id, task_id, kind, path, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.taskId,
        input.kind,
        input.path,
        JSON.stringify(redactObject(input.metadata)),
        new Date().toISOString(),
      );
    return id;
  }

  listByTask(taskId: string): Array<Record<string, unknown>> {
    return this.db
      .prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId)
      .map((row) => row as unknown as Record<string, unknown>);
  }

  deleteByTask(taskId: string): number {
    return Number(
      this.db.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId)
        .changes,
    );
  }
}
