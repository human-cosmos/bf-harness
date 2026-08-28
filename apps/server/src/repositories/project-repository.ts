import { randomUUID } from "node:crypto";
import type { CreateProjectInput, Project } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    repoPath: String(row.repo_path),
    instructionSources: parseJson(String(row.instruction_sources)),
    validationCommands: parseJson(String(row.validation_commands)),
    allowedPaths: parseJson(String(row.allowed_paths)),
    forbiddenPaths: parseJson(String(row.forbidden_paths)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ProjectRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY created_at DESC")
      .all()
      .map((row) => rowToProject(row as unknown as Record<string, unknown>));
  }

  get(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? rowToProject(row as unknown as Record<string, unknown>) : undefined;
  }

  findByRepoPath(repoPath: string): Project | undefined {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE repo_path = ?")
      .get(repoPath);
    return row ? rowToProject(row as unknown as Record<string, unknown>) : undefined;
  }

  create(input: CreateProjectInput): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      repoPath: input.repoPath,
      instructionSources: input.instructionSources ?? [],
      validationCommands: input.validationCommands ?? [],
      allowedPaths: input.allowedPaths ?? [],
      forbiddenPaths: input.forbiddenPaths ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO projects(
          id, name, repo_path, instruction_sources, validation_commands,
          allowed_paths, forbidden_paths, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.repoPath,
        JSON.stringify(project.instructionSources),
        JSON.stringify(project.validationCommands),
        JSON.stringify(project.allowedPaths),
        JSON.stringify(project.forbiddenPaths),
        project.createdAt,
        project.updatedAt,
      );

    return project;
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  }
}
