import { execFile } from "node:child_process";
import { platform } from "node:os";
import { basename } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import {
  PROMPT_TEMPLATE_KEYS,
  type PromptTemplateKey,
} from "@bugfix-harness/shared";
import type { BugfixService } from "./services/bugfix-service.js";
import { DiskMonitor } from "./services/disk-monitor.js";
import { DynamicToolRegistry } from "./services/dynamic-tool-registry.js";

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

  app.get("/api/diagnostics", async () => ({
    runtime: "codex-harness app-server --stdio",
    dataHome: process.env.BUGFIX_HARNESS_HOME ?? "~/.bugfix-harness",
    disk: new DiskMonitor().check(process.cwd()),
  }));

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

  app.post("/api/projects", async (request, reply) => {
    try {
      return await service.createProject(request.body);
    } catch (error) {
      return reply.code(400).send({
        error: (error as Error).message,
      });
    }
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
      return service.conversationService.updateConversation(id, {
        title: body.title,
      });
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/conversations/:id/turns", async (request) => {
    const { id } = request.params as { id: string };
    const { limit, offset } = request.query as {
      limit?: string;
      offset?: string;
    };
    return service.conversationService.listTurns(id, {
      limit: limit ? Number(limit) : 200,
      offset: offset ? Number(offset) : 0,
    });
  });

  app.get("/api/conversations/:id/turns/:turnId/items", async (request) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const { afterSeq, limit } = request.query as {
      afterSeq?: string;
      limit?: string;
    };
    return service.conversationService.listItems(id, {
      turnId,
      afterSeq: afterSeq ? Number(afterSeq) : 0,
      limit: limit ? Number(limit) : 500,
    });
  });

  app.get("/api/conversations/:id/events", async (request) => {
    const { id } = request.params as { id: string };
    const { afterSeq, limit } = request.query as {
      afterSeq?: string;
      limit?: string;
    };
    return service.conversationService.listEvents(id, {
      afterSeq: afterSeq ? Number(afterSeq) : 0,
      limit: limit ? Number(limit) : 1000,
    });
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

  return app;
}
