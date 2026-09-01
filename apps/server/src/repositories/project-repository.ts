import { randomUUID } from "node:crypto";
import type { CreateProjectInput, Project } from "@bugfix-harness/shared";
import type { AppDatabase } from "../db.js";

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function rowToProject(row: Record<string, unknown>): Project {
  const source = String(row.source ?? "local") as Project["source"];
  const remoteHost = row.remote_host
    ? (String(row.remote_host) as Project["remoteHost"])
    : null;
  return {
    id: String(row.id),
    name: String(row.name),
    repoPath: String(row.repo_path),
    source,
    remoteUrl: row.remote_url ? String(row.remote_url) : null,
    remoteHost,
    defaultBranch: row.default_branch ? String(row.default_branch) : null,
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
    const source = input.source ?? "local";
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      repoPath: input.repoPath,
      source,
      remoteUrl: input.remoteUrl ?? null,
      remoteHost: input.remoteHost ?? null,
      defaultBranch: input.defaultBranch ?? null,
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
          id, name, repo_path, source, remote_url, remote_host, default_branch,
          instruction_sources, validation_commands, allowed_paths,
          forbidden_paths, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.repoPath,
        project.source,
        project.remoteUrl ?? null,
        project.remoteHost ?? null,
        project.defaultBranch ?? null,
        JSON.stringify(project.instructionSources),
        JSON.stringify(project.validationCommands),
        JSON.stringify(project.allowedPaths),
        JSON.stringify(project.forbiddenPaths),
        project.createdAt,
        project.updatedAt,
      );

    return project;
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        Project,
        | "name"
        | "repoPath"
        | "instructionSources"
        | "validationCommands"
        | "allowedPaths"
        | "forbiddenPaths"
        | "defaultBranch"
      >
    >,
  ): Project {
    const existing = this.get(id);
    if (!existing) {
      throw new Error("Project not found");
    }
    const project: Project = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE projects SET
          name = ?, repo_path = ?, default_branch = ?,
          instruction_sources = ?, validation_commands = ?,
          allowed_paths = ?, forbidden_paths = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        project.name,
        project.repoPath,
        project.defaultBranch ?? null,
        JSON.stringify(project.instructionSources),
        JSON.stringify(project.validationCommands),
        JSON.stringify(project.allowedPaths),
        JSON.stringify(project.forbiddenPaths),
        project.updatedAt,
        project.id,
      );
    return project;
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM projects WHERE id = ?").run(id).changes > 0;
  }
}
