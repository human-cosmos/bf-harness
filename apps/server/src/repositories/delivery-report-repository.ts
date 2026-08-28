import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db.js";
import type { DeliveryReport } from "../services/delivery-report-service.js";
import { redactObject } from "../services/redaction.js";

export class DeliveryReportRepository {
  constructor(private readonly db: AppDatabase) {}

  save(report: DeliveryReport) {
    this.db
      .prepare(
        `INSERT INTO delivery_reports(id, task_id, content_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        report.id,
        report.taskId,
        JSON.stringify(redactObject(report)),
        report.createdAt,
      );
    return report.id;
  }

  getByTask(taskId: string): DeliveryReport | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM delivery_reports WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(taskId) as unknown as
      | { content_json: string }
      | undefined;
    return row ? JSON.parse(row.content_json) : undefined;
  }
}
