import { execFile } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { platform } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import {
  PROMPT_TEMPLATE_KEYS,
  type PromptTemplateKey,
} from "@bugfix-harness/shared";
import type { BugfixService } from "./services/bugfix-service.js";
import { DiskMonitor } from "./services/disk-monitor.js";
import { DynamicToolRegistry } from "./services/dynamic-tool-registry.js";
import { redactSensitive } from "./services/redaction.js";
import { inferValidationCommands } from "./services/validation-command-infer.js";

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function safeWebPath(webRoot: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" ? "index.html" : `.${decoded}`;
  const target = resolve(webRoot, relative);
  const rootWithSep = webRoot.endsWith(sep) ? webRoot : `${webRoot}${sep}`;
  if (target !== webRoot && !target.startsWith(rootWithSep)) {
    return null;
  }
  return target;
}

function pickDirectory(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (platform() === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "选择 Git 仓库目录")'],
        (error, stdout) => {
          if (error) {
            const message = String(error.message ?? "");
            if (message.includes("cancel") || message.includes("-128")) {
              return resolve(null);
            }
            return reject(error);
          }
          const path = stdout.trim();
          resolve(path || null);
        },
      );
      return;
    }

    if (platform() === "linux") {
      execFile(
        "zenity",
        ["--file-selection", "--directory", "--title=选择 Git 仓库目录"],
        (error, stdout) => {
          if (error) {
            if (error.code === 1) return resolve(null);
            return reject(error);
          }
          const path = stdout.trim();
          resolve(path || null);
        },
      );
      return;
    }

    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }",
      ],
      (error, stdout) => {
        if (error) return reject(error);
        const path = stdout.trim();
        resolve(path || null);
      },
    );
  });
}

function pickFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (platform() === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose file with prompt "选择 Codex 可执行文件")'],
        (error, stdout) => {
          if (error) {
            const message = String(error.message ?? "");
            if (message.includes("cancel") || message.includes("-128")) {
              return resolve(null);
            }
            return reject(error);
          }
          const path = stdout.trim();
          resolve(path || null);
        },
      );
      return;
    }

    if (platform() === "linux") {
      execFile(
        "zenity",
        ["--file-selection", "--title=选择 Codex 可执行文件"],
        (error, stdout) => {
          if (error) {
            if (error.code === 1) return resolve(null);
            return reject(error);
          }
          const path = stdout.trim();
          resolve(path || null);
        },
      );
      return;
    }

    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Executable Files (*.exe)|*.exe|All Files (*.*)|*.*'; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }",
      ],
      (error, stdout) => {
        if (error) return reject(error);
        const path = stdout.trim();
        resolve(path || null);
      },
    );
  });
}

function inspectGitRepo(repoPath: string): Promise<{
  isGitRepo: boolean;
  repoName: string;
}> {
  return new Promise((resolve) => {
    execFile("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], (error, stdout) => {
      if (error) {
        return resolve({ isGitRepo: false, repoName: basename(repoPath) });
      }
      const topLevel = stdout.trim();
      return resolve({
        isGitRepo: true,
        repoName: basename(topLevel || repoPath),
      });
    });
  });
}

function parseConversationPagination(
  query: {
    limit?: string;
    afterSeq?: string;
    offset?: string;
  },
  options: { defaultLimit: number; maxLimit: number },
):
  | {
      limit: number;
      afterSeq?: number;
      offset?: number;
    }
  | { error: string } {
  const limitRaw = query.limit;
  const afterSeqRaw = query.afterSeq;
  const offsetRaw = query.offset;

  const parseInteger = (
    value: string | undefined,
    fallback: number,
    name: string,
    max: number,
  ): { value?: number; error?: string } => {
    if (value === undefined) return { value: fallback };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: `${name} must be a non-negative integer` };
    }
    if (parsed > max) {
      return { error: `${name} must be <= ${max}` };
    }
    return { value: parsed };
  };

  const limit = parseInteger(
    limitRaw,
    options.defaultLimit,
    "limit",
    options.maxLimit,
  );
  if (limit.error) return { error: limit.error };
  if (!limit.value || limit.value === 0) {
    return { error: "limit must be a positive integer" };
  }

  if (afterSeqRaw !== undefined) {
    const afterSeq = parseInteger(afterSeqRaw, 0, "afterSeq", Number.MAX_SAFE_INTEGER);
    if (afterSeq.error) return { error: afterSeq.error };
    if (afterSeq.value !== undefined) {
      return { limit: limit.value, afterSeq: afterSeq.value };
    }
  }

  if (offsetRaw !== undefined) {
    const offset = parseInteger(offsetRaw, 0, "offset", Number.MAX_SAFE_INTEGER);
    if (offset.error) return { error: offset.error };
    if (offset.value !== undefined) {
      return { limit: limit.value, offset: offset.value };
    }
  }

  return { limit: limit.value };
}

export async function buildApp(service: BugfixService) {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/fs/pick-directory", async (_request, reply) => {
    try {
      const path = await pickDirectory();
      if (!path) {
        return { path: null, isGitRepo: false, repoName: null };
      }
      const info = await inspectGitRepo(path);
      return {
        path,
        isGitRepo: info.isGitRepo,
        repoName: info.repoName,
      };
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  app.post("/api/fs/pick-file", async (_request, reply) => {
    try {
      const path = await pickFile();
      return { path };
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  app.get("/api/runtime/codex", async () => {
    return service.codexRuntime.detect();
  });

  app.put("/api/runtime/codex", async (request, reply) => {
    const body = request.body as { path?: string } | null;
    if (!body?.path?.trim()) {
      return reply.code(400).send({ error: "path is required" });
    }
    try {
      return service.codexRuntime.saveManualCodexBin(body.path);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/diagnostics", async () => {
    const systemSettings = service.systemSettings.get();
    return {
      runtime: "codex-harness app-server --stdio",
      dataHome: process.env.BUGFIX_HARNESS_HOME ?? "~/.bugfix-harness",
      settings: systemSettings,
      disk: new DiskMonitor({
        totalDataLimitBytes: systemSettings.storage.totalDataLimitBytes,
        warnRatio: systemSettings.storage.diskWarnRatio,
      }).check(process.cwd()),
    };
  });

  app.get("/api/settings", async () => ({
    settings: service.systemSettings.get(),
    defaults: service.systemSettings.getDefaults(),
  }));

  app.put("/api/settings", async (request, reply) => {
    const body = request.body as { settings?: unknown } | null;
    if (!body || typeof body !== "object" || body.settings === undefined) {
      return reply.code(400).send({ error: "settings is required" });
    }
    try {
      return {
        settings: service.systemSettings.save(body.settings),
        defaults: service.systemSettings.getDefaults(),
      };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/settings/reset", async () => {
    return {
      settings: service.systemSettings.reset(),
      defaults: service.systemSettings.getDefaults(),
    };
  });

  app.get("/api/settings/prompts", async () => {
    return service.listPromptTemplates();
  });

  app.put("/api/settings/prompts", async (request, reply) => {
    const body = request.body as {
      templates?: Partial<Record<PromptTemplateKey, string>>;
    } | null;
    if (!body?.templates || typeof body.templates !== "object") {
      return reply.code(400).send({ error: "templates is required" });
    }

    if (Object.keys(body.templates).length === 0) {
      return reply.code(400).send({ error: "templates must not be empty" });
    }

    for (const key of Object.keys(body.templates)) {
      if (!PROMPT_TEMPLATE_KEYS.includes(key as PromptTemplateKey)) {
        return reply.code(400).send({
          error: `Unknown prompt template key: ${key}`,
        });
      }
    }

    try {
      return await service.savePromptTemplates(
        body.templates as Partial<Record<PromptTemplateKey, string>>,
      );
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/settings/prompts/reset", async (request, reply) => {
    const body = request.body as { key?: string } | null;
    const key = body?.key;
    if (key !== undefined && !PROMPT_TEMPLATE_KEYS.includes(key as PromptTemplateKey)) {
      return reply.code(400).send({ error: "Unknown prompt template key" });
    }

    try {
      return await service.resetPromptTemplates(key as PromptTemplateKey | undefined);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/ws", { websocket: true }, (socket: any) => {
    const unsubscribe = service.events.subscribe((event) => {
      if (socket.readyState === 1) {
        const payload = event.payload as
          | { conversationId?: unknown }
          | undefined;
        const scope = event.taskId
          ? { kind: "task", id: event.taskId }
          : payload?.conversationId
            ? { kind: "conversation", id: String(payload.conversationId) }
            : undefined;
        socket.send(JSON.stringify({ ...event, scope }));
      }
    });
    socket.send(
      JSON.stringify({
        type: "connected",
        emittedAt: new Date().toISOString(),
      }),
    );
    socket.on("close", unsubscribe);
  });

  app.get("/api/projects", async () => service.projects.list());

  app.get("/api/projects/summary", async () => {
    return service.projects.list().map((project) => {
      const tasks = service.tasks.list(project.id);
      return {
        ...project,
        taskCount: tasks.length,
        pendingTaskCount: tasks.filter((task) =>
          [
            "PREPARING_WORKSPACE",
            "ANALYZING",
            "WAITING_FOR_PLAN_APPROVAL",
            "IMPLEMENTING",
            "VALIDATING",
            "WAITING_FOR_ACCEPTANCE",
          ].includes(task.status),
        ).length,
      };
    });
  });

  app.get("/api/projects/validation-preview", async (request, reply) => {
    const repoPath = String(
      (request.query as { repoPath?: string }).repoPath ?? "",
    ).trim();
    if (!repoPath) {
      return reply.code(400).send({ error: "repoPath is required" });
    }
    return {
      commands: inferValidationCommands(repoPath),
    };
  });

  app.get("/api/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = service.projects.get(id);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return project;
  });

  app.patch("/api/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return service.updateProject(id, request.body);
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Project not found") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/projects", async (request, reply) => {
    try {
      return await service.createProject(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  app.post("/api/projects/remote", async (request, reply) => {
    try {
      const job = service.startRemoteClone(request.body);
      return reply.code(202).send({ jobId: job.id, job });
    } catch (error) {
      return reply.code(400).send({
        error: redactSensitive((error as Error).message),
      });
    }
  });

  app.get("/api/projects/remote/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = service.getRemoteCloneJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: "Clone job not found" });
    }
    return { job };
  });

  app.delete("/api/projects/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.deleteProject(id);
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Project not found") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/api/projects/:projectId/conversations", async (request) => {
    const { projectId } = request.params as { projectId: string };
    return service.conversationService.listConversations(projectId);
  });

  app.get(
    "/api/projects/:projectId/conversations/page",
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const { page, pageSize } = request.query as {
        page?: string;
        pageSize?: string;
      };
      const parsedPage = Number.parseInt(page ?? "1", 10);
      const parsedPageSize = Number.parseInt(pageSize ?? "20", 10);
      if (
        !Number.isFinite(parsedPage) ||
        !Number.isFinite(parsedPageSize) ||
        parsedPage < 1 ||
        parsedPageSize < 1
      ) {
        return reply.code(400).send({ error: "invalid pagination parameters" });
      }
      return service.conversationService.listConversationsPage(
        projectId,
        parsedPage,
        parsedPageSize,
      );
    },
  );

  app.post("/api/projects/:projectId/conversations", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      return await service.conversationService.createConversation({
        ...(request.body ?? {}),
        projectId,
      });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversation = service.conversationService.getConversation(id);
    if (!conversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    return conversation;
  });

  app.patch("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return service.conversationService.updateConversation(id, request.body);
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Conversation not found") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.delete("/api/conversations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.conversationService.deleteConversation(id);
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Conversation not found") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/conversations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await service.conversationService.sendMessage(
        id,
        request.body,
      );
      return result;
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/conversations/:id/steer", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.conversationService.steerConversation(
        id,
        request.body,
      );
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/conversations/:id/interrupt", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await service.conversationService.interruptConversation(id);
      return { interrupted: true };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/conversations/:id/fork", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { lastTurnId?: string | null } | null;
    try {
      return await service.conversationService.forkConversation(id, {
        lastTurnId: body?.lastTurnId ?? null,
      });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/conversations/:id/compact", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.conversationService.compactConversation(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/conversations/:id/archive", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.conversationService.archiveConversation(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/conversations/:id/name", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { title?: string } | null;
    if (!body?.title?.trim()) {
      return reply.code(400).send({ error: "title is required" });
    }
    try {
      return await service.conversationService.renameConversation(
        id,
        body.title,
      );
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Conversation not found") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/api/conversations/:id/turns", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit, offset } = request.query as {
      limit?: string;
      offset?: string;
    };
    const page = parseConversationPagination(
      { limit, offset },
      { defaultLimit: 200, maxLimit: 1000 },
    );
    if ("error" in page) {
      return reply.code(400).send({ error: page.error });
    }
    return service.conversationService.listTurns(id, {
      limit: page.limit,
      offset: page.offset ?? 0,
    });
  });

  app.get("/api/conversations/:id/turns/:turnId/items", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const { afterSeq, limit } = request.query as {
      afterSeq?: string;
      limit?: string;
    };
    const page = parseConversationPagination(
      { afterSeq, limit },
      { defaultLimit: 500, maxLimit: 1000 },
    );
    if ("error" in page) {
      return reply.code(400).send({ error: page.error });
    }
    return service.conversationService.listItems(id, {
      turnId,
      afterSeq: page.afterSeq ?? 0,
      limit: page.limit,
    });
  });

  app.get("/api/conversations/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { afterSeq, limit } = request.query as {
      afterSeq?: string;
      limit?: string;
    };
    const page = parseConversationPagination(
      { afterSeq, limit },
      { defaultLimit: 1000, maxLimit: 1000 },
    );
    if ("error" in page) {
      return reply.code(400).send({ error: page.error });
    }
    return service.conversationService.listEvents(id, {
      afterSeq: page.afterSeq ?? 0,
      limit: page.limit,
    });
  });

  app.get("/api/conversations/:id/items", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { afterSeq, limit } = request.query as {
      afterSeq?: string;
      limit?: string;
    };
    const page = parseConversationPagination(
      { afterSeq, limit },
      { defaultLimit: 1000, maxLimit: 1000 },
    );
    if ("error" in page) {
      return reply.code(400).send({ error: page.error });
    }
    return service.conversationService.listItems(id, {
      afterSeq: page.afterSeq ?? 0,
      limit: page.limit,
    });
  });

  app.post("/api/conversations/:id/sync", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.conversationService.syncConversationHistory(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/conversations/:id/models", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.conversationService.listModels(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/conversations/:id/approvals", async (request) => {
    const { id } = request.params as { id: string };
    return service.conversationService.getPendingApprovals(id);
  });

  app.post(
    "/api/conversations/:id/approvals/:approvalId/decision",
    async (request, reply) => {
      const { id, approvalId } = request.params as {
        id: string;
        approvalId: string;
      };
      const body = request.body as {
        decision?: "accept" | "acceptForSession" | "decline" | "cancel";
      } | null;
      if (!body?.decision) {
        return reply.code(400).send({ error: "decision is required" });
      }
      try {
        service.conversationService.decideApproval(
          id,
          approvalId,
          body.decision,
        );
        return { decided: true };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.get("/api/conversations/:id/clarification", async (request) => {
    const { id } = request.params as { id: string };
    return service.conversationService.getPendingClarification(id);
  });

  app.post("/api/conversations/:id/clarification", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as
      | {
          clarificationId?: string;
          answers?: Record<string, { answers?: string[] }>;
        }
      | null;
    if (!body?.clarificationId || !body.answers) {
      return reply.code(400).send({
        error: "clarificationId and answers are required",
      });
    }
    const answers: Record<string, { answers: string[] }> = {};
    for (const [questionId, value] of Object.entries(body.answers)) {
      answers[questionId] = {
        answers: Array.isArray(value?.answers)
          ? value.answers.map((item) => String(item))
          : [],
      };
    }
    try {
      service.conversationService.answerClarification(
        id,
        body.clarificationId,
        answers,
      );
      return { answered: true };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/projects/:projectId/fs/search", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { query } = request.query as { query?: string };
    const project = service.projects.get(projectId);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    try {
      const registry = new DynamicToolRegistry(project.repoPath);
      return await registry.call({
        tool: "fuzzyFileSearch",
        arguments: { query: query ?? "" },
      });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return service.tasks.list(projectId);
  });

  app.get("/api/tasks/attention-summary", async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) {
      return reply.code(400).send({ error: "projectId is required" });
    }
    const summary: Record<string, unknown> = {};
    for (const task of service.tasks.list(projectId)) {
      summary[task.id] = service.getAttention(task.id);
    }
    return summary;
  });

  app.post("/api/tasks", async (request, reply) => {
    try {
      return await service.createTask(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  app.get("/api/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = service.tasks.get(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    const contract = service.tasks.getContract(id);
    return { task, contract };
  });

  app.get("/api/tasks/:id/workflow-state", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.getWorkflowState(id);
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  app.get("/api/tasks/:id/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = service.getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }
    return job;
  });

  app.post("/api/tasks/:id/prepare-worktree", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.prepareWorktree(id);
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
  });

  app.get("/api/tasks/:id/plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = service.workflow.plans.getLatest(id);
    if (!plan) {
      return reply.code(404).send({ error: "Plan not found" });
    }
    return plan;
  });

  app.post("/api/tasks/:id/plan/question", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { question?: string } | undefined;
    if (!body?.question?.trim()) {
      return reply.code(400).send({ error: "question is required" });
    }
    try {
      return { answer: await service.askPlanQuestion(id, body.question) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks/:id/attention", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = service.tasks.get(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return service.getAttention(id);
  });

  app.post("/api/tasks/:id/plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return service.workflow.submitPlan(id, request.body);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/plan/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment?: string } | undefined;
    try {
      return service.workflow.approvePlan(id, body?.comment);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/plan/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment?: string } | undefined;
    try {
      return service.workflow.rejectPlan(id, body?.comment);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.cancelTask(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.delete("/api/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.deleteTask(id);
    } catch (error) {
      const message = (error as Error).message;
      if (message === "Task not found") {
        return reply.code(404).send({ error: message });
      }
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/tasks/:id/accept", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return service.workflow.acceptTask(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment?: string } | undefined;
    try {
      return service.workflow.rejectTask(id, body?.comment);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/return", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { comment?: string } | undefined;
    try {
      return service.workflow.returnTaskForRework(id, body?.comment);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks/:id/approvals", async (request) => {
    const { id } = request.params as { id: string };
    return service.execution.approvals.listByTask(id);
  });

  app.get("/api/tasks/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit, afterSeq } = request.query as {
      limit?: string;
      afterSeq?: string;
    };
    const parsedLimit = limit ? Number(limit) : 100;
    const parsedAfterSeq = afterSeq ? Number(afterSeq) : 0;
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit <= 0 ||
      parsedLimit > 1000 ||
      !Number.isInteger(parsedAfterSeq) ||
      parsedAfterSeq < 0
    ) {
      return reply.code(400).send({
        error: "limit must be a positive integer <= 1000 and afterSeq must be a non-negative integer",
      });
    }
    return service.agentEvents.listByTask(id, {
      limit: parsedLimit,
      afterSeq: parsedAfterSeq,
    });
  });

  app.get("/api/tasks/:id/logs", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!service.tasks.get(id)) {
      return reply.code(404).send({ error: "Task not found" });
    }
    const query = request.query as {
      afterSeq?: string;
      limit?: string;
      level?: string;
      source?: string;
      phase?: string;
    };
    const parsedLimit = query.limit ? Number(query.limit) : 100;
    const parsedAfterSeq = query.afterSeq ? Number(query.afterSeq) : 0;
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit <= 0 ||
      parsedLimit > 1000 ||
      !Number.isInteger(parsedAfterSeq) ||
      parsedAfterSeq < 0
    ) {
      return reply.code(400).send({
        error:
          "limit must be a positive integer <= 1000 and afterSeq must be a non-negative integer",
      });
    }

    const allowedLevels = new Set(["debug", "info", "warn", "error"]);
    const allowedSources = new Set([
      "runtime",
      "workflow",
      "validation",
      "approval",
      "server",
    ]);
    const allowedPhases = new Set([
      "prepare",
      "analyze",
      "plan",
      "implement",
      "validate",
      "report",
      "lifecycle",
    ]);
    if (query.level && !allowedLevels.has(query.level)) {
      return reply.code(400).send({ error: "level is invalid" });
    }
    if (query.source && !allowedSources.has(query.source)) {
      return reply.code(400).send({ error: "source is invalid" });
    }
    if (query.phase && !allowedPhases.has(query.phase)) {
      return reply.code(400).send({ error: "phase is invalid" });
    }

    const rows = service.agentEvents.listLogsByTask(id, {
      afterSeq: parsedAfterSeq,
      limit: parsedLimit + 1,
      level: query.level as
        | "debug"
        | "info"
        | "warn"
        | "error"
        | undefined,
      source: query.source as
        | "runtime"
        | "workflow"
        | "validation"
        | "approval"
        | "server"
        | undefined,
      phase: query.phase as
        | "prepare"
        | "analyze"
        | "plan"
        | "implement"
        | "validate"
        | "report"
        | "lifecycle"
        | undefined,
    });

    const hasMore = rows.length > parsedLimit;
    const items = hasMore ? rows.slice(0, parsedLimit) : rows;
    const last = items.at(-1) as { seq?: number } | undefined;
    return {
      items,
      nextAfterSeq: hasMore && last ? last.seq ?? null : null,
    };
  });

  app.post("/api/tasks/:id/approvals", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.execution.recordApproval(id, request.body as any);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/approvals/:approvalId/decision", async (request, reply) => {
    const { id, approvalId } = request.params as {
      id: string;
      approvalId: string;
    };
    const body = request.body as { decision?: "accept" | "decline" | "cancel" };
    if (!body?.decision) {
      return reply.code(400).send({ error: "decision is required" });
    }
    try {
      return service.execution.decideApproval(id, approvalId, body.decision);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/approvals/decision-batch", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      decision?: "accept" | "decline" | "cancel";
      approvalIds?: string[];
    };
    if (
      !body?.decision ||
      !Array.isArray(body.approvalIds) ||
      body.approvalIds.length === 0
    ) {
      return reply.code(400).send({
        error: "decision and non-empty approvalIds are required",
      });
    }
    try {
      return service.execution.decideApprovals(
        id,
        body.approvalIds,
        body.decision,
      );
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks/:id/diff", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.execution.generateDiff(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/validate", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = service.startValidationJob(id);
      return reply.code(202).send({ jobId: job.id, job });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks/:id/validations", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = service.tasks.get(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return service.execution.listValidations(id);
  });

  app.post("/api/tasks/:id/continue-fix", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = service.startContinueFixJob(id);
      return reply.code(202).send({ jobId: job.id, job });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = service.tasks.get(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    const report = service.execution.reports.getByTask(id);
    if (!report) {
      return reply.code(404).send({ error: "Report not found" });
    }
    return report;
  });

  app.post("/api/tasks/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = service.startReportJob(id);
      return reply.code(202).send({ jobId: job.id, job });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/analyze", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return service.startAnalyze(id);
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/tasks/:id/analysis", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = service.tasks.get(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return service.getAnalysisRun(id);
  });

  app.get("/api/tasks/:id/clarification", async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = service.tasks.get(id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return service.getClarification(id);
  });

  app.post("/api/tasks/:id/clarification", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as
      | { answers?: Record<string, { answers?: string[] }> }
      | undefined;
    if (!body?.answers || typeof body.answers !== "object") {
      return reply.code(400).send({ error: "answers is required" });
    }

    const answers: Record<string, { answers: string[] }> = {};
    for (const [questionId, value] of Object.entries(body.answers)) {
      const answersValue = Array.isArray(value?.answers)
        ? value.answers.map((item) => String(item))
        : [];
      answers[questionId] = { answers: answersValue };
    }

    const answered = service.answerClarification(id, answers);
    if (!answered) {
      return reply.code(409).send({ error: "No pending clarification" });
    }
    return { answered: true };
  });

  app.post("/api/tasks/:id/implement", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = service.startImplementJob(id);
      return reply.code(202).send({ jobId: job.id, job });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  const webRoot = process.env.BUGFIX_HARNESS_WEB_ROOT?.trim();
  if (webRoot) {
    const indexFile = join(webRoot, "index.html");
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }

      const pathname = new URL(request.url, "http://localhost").pathname;
      const filePath = safeWebPath(webRoot, pathname);
      if (filePath && filePath !== indexFile && existsSync(filePath)) {
        try {
          if (statSync(filePath).isFile()) {
            return reply
              .type(contentTypeFor(filePath))
              .send(createReadStream(filePath));
          }
        } catch {
          // Fall through to the SPA entry point.
        }
      }

      if (!existsSync(indexFile)) {
        return reply.code(404).send({ error: "Web root has no index.html" });
      }
      return reply
        .type("text/html; charset=utf-8")
        .send(createReadStream(indexFile));
    });
  }

  return app;
}
