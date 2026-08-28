import { execFile } from "node:child_process";
import { platform } from "node:os";
import { basename } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { BugfixService } from "./services/bugfix-service.js";
import { DiskMonitor } from "./services/disk-monitor.js";

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

  app.get("/api/ws", { websocket: true }, (socket: any) => {
    const unsubscribe = service.events.subscribe((event) => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(event));
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
    const deleted = service.projects.delete(id);
    if (!deleted) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return { deleted: true };
  });

  app.get("/api/tasks", async (request) => {
    const { projectId } = request.query as { projectId?: string };
    return service.tasks.list(projectId);
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
      return reply.code(400).send({ error: (error as Error).message });
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

  app.get("/api/tasks/:id/events", async (request) => {
    const { id } = request.params as { id: string };
    const { limit, afterSeq } = request.query as {
      limit?: string;
      afterSeq?: string;
    };
    return service.agentEvents.listByTask(id, {
      limit: limit ? Number(limit) : 100,
      afterSeq: afterSeq ? Number(afterSeq) : 0,
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
      return await service.execution.runValidations(id);
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
      return { output: await service.continueFix(id) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tasks/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await service.execution.buildReport(id);
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
      return { output: await service.agent.implement(id) };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  return app;
}
