import { existsSync, rmSync } from "node:fs";
import { ArtifactRepository } from "../repositories/artifact-repository.js";

export class FileCleanupExecutor {
  constructor(private readonly artifacts: ArtifactRepository) {}

  cleanupTaskArtifacts(
    taskId: string,
    options: { confirmed: boolean },
  ): { deletedFiles: string[]; deletedRecords: number } {
    if (!options.confirmed) {
      throw new Error("Artifact cleanup requires explicit user confirmation");
    }

    const rows = this.artifacts.listByTask(taskId);
    const deletedFiles: string[] = [];
    for (const row of rows) {
      const path = String(row.path);
      if (existsSync(path)) {
        rmSync(path, { force: true });
        deletedFiles.push(path);
      }
    }

    const deletedRecords = this.artifacts.deleteByTask(taskId);
    return { deletedFiles, deletedRecords };
  }

  previewTaskArtifacts(taskId: string) {
    return this.artifacts.listByTask(taskId);
  }
}
