import {
  ANALYZE_OUTPUT_REQUIREMENTS,
  buildAnalyzePrompt,
  buildAnalyzeRetryPrompt,
  buildImplementPrompt,
  buildPlanQuestionPrompt,
  coerceRepairPlan,
  planOutputSchema,
  planSchema,
  type ClarificationQuestion,
  type RepairPlan,
  type SystemSettings,
  type Worktree,
} from "@bugfix-harness/shared";
import { AgentSessionRepository } from "../repositories/agent-session-repository.js";
import { AgentEventRepository } from "../repositories/agent-event-repository.js";
import { PlanApprovalRepository } from "../repositories/plan-approval-repository.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { TaskRepository } from "../repositories/task-repository.js";
import { PromptTemplateRepository } from "../repositories/prompt-template-repository.js";
import { WorktreeRepository } from "../repositories/worktree-repository.js";
import { AppServerRuntime } from "./app-server-runtime.js";
import { ExecutionService } from "./execution-service.js";
import { WorkflowService } from "./workflow-service.js";
import { RuntimeEventRecorder } from "./runtime-event-recorder.js";
import { ClarificationCoordinator } from "./clarification-coordinator.js";
import type { ApprovalRequest } from "./approval-policy.js";
import { loadInstructionSources } from "./instruction-source-loader.js";

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractJsonText(text: string): string {
  const stripped = stripCodeFences(text);
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = stripped.slice(start, end + 1);
      JSON.parse(candidate);
      return candidate;
    }
    throw new Error("Agent output did not contain a JSON object");
  }
}

export function parseRepairPlanText(
  agentText: string,
  roots: string[] = [],
): RepairPlan {
  try {
    return planSchema.parse(
      coerceRepairPlan(JSON.parse(extractJsonText(agentText)), roots),
    );
  } catch (error) {
    throw new Error(
      `Failed to parse repair plan from agent output: ${
        (error as Error).message
      }\n${agentText.slice(0, 2000)}`,
    );
  }
}

export function buildApprovalResponse(
  method: string,
  decision: "accept" | "decline" | "cancel",
  params: Record<string, unknown>,
): unknown {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return { decision };
  }

  if (method === "item/permissions/requestApproval") {
    if (decision === "accept") {
      return { permissions: params.permissions ?? {}, scope: "turn" };
    }
    return { permissions: {}, scope: "turn" };
  }

  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    if (decision === "accept") {
      return { decision: "approved" };
    }
    if (decision === "cancel") {
      return { decision: "abort" };
    }
    return { decision: { denied: { rejection: "declined by reviewer" } } };
  }

  return { decision };
}

export class AgentOrchestrator {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly worktrees: WorktreeRepository,
    private readonly workflow: WorkflowService,
    private readonly execution: ExecutionService,
    private readonly sessions: AgentSessionRepository,
    private readonly events: AgentEventRepository,
    private readonly plans: PlanApprovalRepository,
    private readonly getCodexBin: () => string,
    private readonly promptTemplates: PromptTemplateRepository,
    private readonly prepareWorktree: (taskId: string) => Promise<Worktree>,
    private readonly clarifications: ClarificationCoordinator,
    private readonly getSystemSettings: () => SystemSettings,
  ) {}

  private readonly activeRuntimes = new Map<string, AppServerRuntime>();

  shutdown(): void {
    const runtimes = [...this.activeRuntimes.values()];
    this.activeRuntimes.clear();
    for (const runtime of runtimes) {
      try {
        runtime.close();
      } catch {
        // Best effort during shutdown.
      }
    }
  }

  async interruptTask(taskId: string): Promise<void> {
    const runtime = this.activeRuntimes.get(taskId);
    if (!runtime) {
      return;
    }

    if (runtime.currentThreadId && runtime.currentTurnId) {
      try {
        await runtime.interrupt(runtime.currentThreadId, runtime.currentTurnId);
      } catch {
        // The turn may have already completed. Closing below remains best-effort.
      }
    }

    try {
      runtime.close();
    } catch {
      // Ignore double-close or process-guard errors during cancellation.
    }
  }

  private async resumeThreadWithRetry(
    runtime: AppServerRuntime,
    threadId: string,
    overrides: Parameters<AppServerRuntime["resumeThread"]>[1],
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await runtime.resumeThread(threadId, overrides);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isActiveWriter =
          message.includes("already has an active writer") ||
          (message.includes("active writer") && message.includes("-32600"));
        if (!isActiveWriter) {
          throw error;
        }
        lastError = error;
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }
    throw lastError;
  }

  private trackRuntime(taskId: string, runtime: AppServerRuntime): void {
    this.activeRuntimes.set(taskId, runtime);
  }

  private untrackRuntime(taskId: string, runtime: AppServerRuntime): void {
    if (this.activeRuntimes.get(taskId) === runtime) {
      this.activeRuntimes.delete(taskId);
    }
  }

  async analyze(taskId: string): Promise<RepairPlan> {
    let task = this.requireTask(taskId);
    if (task.status === "DRAFT") {
      this.workflow.transitionTask(taskId, "PREPARING_WORKSPACE");
      task = this.requireTask(taskId);
    }
    if (task.status === "PREPARING_WORKSPACE") {
      await this.prepareWorktree(taskId);
    }
    if (task.status !== "ANALYZING") {
      this.workflow.transitionTask(taskId, "ANALYZING");
    }

    let failureDetails: {
      message: string;
      threadId?: string;
      turnId?: string;
    } | null = null;

    try {
      const project = this.projects.get(task.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      const contract = this.tasks.getContract(taskId);
      if (!contract) {
        throw new Error("Task contract not found");
      }
      const worktree = this.worktrees.getByTaskId(taskId);
      if (!worktree || worktree.status !== "READY") {
        throw new Error("Worktree not ready");
      }

      const developerInstructions = await loadInstructionSources({
        repoPath: project.repoPath,
        worktreePath: worktree.path,
        instructionSources: project.instructionSources,
      });

      const runtime = new AppServerRuntime({
        codexBin: this.getCodexBin(),
        cwd: worktree.path,
        approvalMode:
          this.getSystemSettings().security.bugfixAutomationMode === "auto"
            ? "accept"
            : "decline",
      }).start();
      this.trackRuntime(taskId, runtime);
      runtime.onServerRequest = async (message) => {
        if (message.method === "item/tool/requestUserInput") {
          const params = (message.params ?? {}) as {
            threadId?: string;
            turnId?: string;
            itemId?: string;
            questions?: ClarificationQuestion[];
          };
          const answers = await this.clarifications.request({
            taskId,
            requestId: message.id!,
            threadId: params.threadId ?? runtime.currentThreadId,
            turnId: params.turnId ?? runtime.currentTurnId,
            itemId: params.itemId ?? null,
            questions: params.questions ?? [],
          });
          return { answers };
        }
        return undefined;
      };
      const detach = new RuntimeEventRecorder(
        this.events,
        taskId,
        undefined,
        "analyze",
      ).attach(runtime);

      try {
        await runtime.initialize({
          name: "bugfix-harness",
          title: "Bugfix Harness",
          version: "0.1.0",
        });
        const settings = this.getSystemSettings();
        await runtime.startThread({
          cwd: worktree.path,
          sandbox: "read-only",
          approvalPolicy: settings.security.analyzeApprovalPolicy,
          approvalsReviewer: settings.security.analyzeApprovalsReviewer,
          ephemeral: false,
          developerInstructions: developerInstructions || undefined,
        });
        await runtime.startTurn({
          threadId: runtime.currentThreadId!,
          input: [
            {
              type: "text",
              text: [
                buildAnalyzePrompt(
                  contract,
                  this.promptTemplates.get("analyze"),
                ),
                "",
                ANALYZE_OUTPUT_REQUIREMENTS,
              ].join("\n"),
            },
          ],
          outputSchema: planOutputSchema,
          approvalPolicy: settings.security.analyzeApprovalPolicy,
          approvalsReviewer: settings.security.analyzeApprovalsReviewer,
          model: settings.models.bugfixModel ?? null,
          effort: settings.models.bugfixReasoningEffort ?? null,
          sandboxPolicy: {
            type: "readOnly",
            networkAccess: false,
          },
        });
        await runtime.waitForTurnCompletion({
          idleTimeoutMs: settings.agent.analysisIdleTimeoutMs,
          maxTimeoutMs: settings.agent.analysisMaxDurationMs,
        });

        const agentText = runtime.getAgentText();
        let plan: RepairPlan;
        try {
          plan = parseRepairPlanText(agentText, [
            worktree.path,
            project.repoPath,
          ]);
        } catch (error) {
          try {
            this.events.append({
              taskId,
              codexThreadId: runtime.currentThreadId ?? undefined,
              codexTurnId: runtime.currentTurnId ?? undefined,
              method: "analysis.parse_retry",
              payload: { error: (error as Error).message },
              level: "warn",
              source: "runtime",
              phase: "analyze",
              message: "修复计划 JSON 不完整，正在请求精简重试。",
            });
          } catch {
            // Retrying the analysis is more important than recording the warning.
          }
          await runtime.startTurn({
            threadId: runtime.currentThreadId!,
            input: [{ type: "text", text: buildAnalyzeRetryPrompt() }],
            outputSchema: planOutputSchema,
            approvalPolicy: settings.security.analyzeApprovalPolicy,
            approvalsReviewer: settings.security.analyzeApprovalsReviewer,
            model: settings.models.bugfixModel ?? null,
            effort: settings.models.bugfixReasoningEffort ?? null,
            sandboxPolicy: {
              type: "readOnly",
              networkAccess: false,
            },
          });
          await runtime.waitForTurnCompletion({
            idleTimeoutMs: settings.agent.analysisIdleTimeoutMs,
            maxTimeoutMs: settings.agent.analysisMaxDurationMs,
          });
          plan = parseRepairPlanText(runtime.getAgentText(), [
            worktree.path,
            project.repoPath,
          ]);
        }
        this.workflow.submitPlan(taskId, plan);
        this.sessions.create({
          taskId,
          codexThreadId: runtime.currentThreadId!,
        });
        return plan;
      } catch (error) {
        failureDetails = {
          message: error instanceof Error ? error.message : String(error),
          threadId: runtime.currentThreadId ?? undefined,
          turnId: runtime.currentTurnId ?? undefined,
        };
        throw error;
      } finally {
        this.untrackRuntime(taskId, runtime);
        detach();
        await runtime.closeAndWait();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        this.events.append({
          taskId,
          codexThreadId: failureDetails?.threadId,
          codexTurnId: failureDetails?.turnId,
          method: "analysis.failed",
          payload: { error: message },
          level: "error",
          source: "runtime",
          phase: "analyze",
          message: `分析阶段失败：${message}`,
        });
      } catch {
        // Keep the original analysis error as the source of truth.
      }
      if (this.tasks.get(taskId)?.status === "ANALYZING") {
        this.workflow.transitionTask(taskId, "FAILED");
      }
      throw error;
    }
  }

  async implement(taskId: string, validationFeedback?: string): Promise<string> {
    const task = this.requireTask(taskId);
    if (task.status !== "IMPLEMENTING") {
      throw new Error(`Expected task status IMPLEMENTING, got ${task.status}`);
    }
    const contract = this.tasks.getContract(taskId);
    if (!contract) {
      throw new Error("Task contract not found");
    }
    const planApproval = this.plans.getLatest(taskId);
    if (!planApproval || planApproval.status !== "APPROVED") {
      throw new Error("No approved repair plan");
    }
    const worktree = this.worktrees.getByTaskId(taskId);
    if (!worktree || worktree.status !== "READY") {
      throw new Error("Worktree not ready");
    }
    const session = this.sessions.getLatest(taskId);
    if (!session) {
      throw new Error("No analysis session");
    }

    const project = this.projects.get(task.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    const developerInstructions = await loadInstructionSources({
      repoPath: project.repoPath,
      worktreePath: worktree.path,
      instructionSources: project.instructionSources,
    });

    const runtime = new AppServerRuntime({
      codexBin: this.getCodexBin(),
      cwd: worktree.path,
      approvalMode:
        this.getSystemSettings().security.bugfixAutomationMode === "auto"
          ? "accept"
          : "decline",
    }).start();
    this.trackRuntime(taskId, runtime);
    const detach = new RuntimeEventRecorder(
      this.events,
      taskId,
      undefined,
      "implement",
    ).attach(runtime);

    runtime.onServerRequest = async (message) => {
      const params = (message.params ?? {}) as Record<string, unknown>;
      const method = message.method ?? "";
      let request: ApprovalRequest | null = null;

      if (method === "item/commandExecution/requestApproval") {
        const networkContext = params.networkApprovalContext as
          | { host?: string | null }
          | null
          | undefined;
        if (networkContext?.host) {
          request = { kind: "network", host: String(networkContext.host) };
        } else {
          request = {
            kind: "command",
            command: String(params.command ?? ""),
            cwd: String(params.cwd ?? worktree.path),
          };
        }
      } else if (method === "execCommandApproval") {
        const command = Array.isArray(params.command)
          ? params.command.map((item) => String(item)).join(" ")
          : String(params.command ?? "");
        request = {
          kind: "command",
          command,
          cwd: String(params.cwd ?? worktree.path),
        };
      } else if (method === "item/fileChange/requestApproval") {
        request = {
          kind: "file",
          path: String(params.grantRoot ?? worktree.path),
          action: "write",
        };
      } else if (method === "applyPatchApproval") {
        request = {
          kind: "file",
          path: String(params.grantRoot ?? worktree.path),
          action: "write",
        };
      } else if (method === "item/permissions/requestApproval") {
        request = {
          kind: "permissions",
          reason: params.reason ? String(params.reason) : undefined,
          permissions: params.permissions,
        };
      }

      if (!request) {
        return undefined;
      }

      const result = await this.execution.requestApprovalDecision(
        taskId,
        request,
        message.id,
      );
      return buildApprovalResponse(method, result.decision, params);
    };

    try {
      await runtime.initialize({
        name: "bugfix-harness",
        title: "Bugfix Harness",
        version: "0.1.0",
      });
      const settings = this.getSystemSettings();
      await this.resumeThreadWithRetry(runtime, session.codexThreadId, {
        approvalPolicy: settings.security.implementApprovalPolicy,
        approvalsReviewer: settings.security.implementApprovalsReviewer,
        developerInstructions: developerInstructions || undefined,
      });
      await runtime.startTurn({
        threadId: session.codexThreadId,
        input: [
          {
            type: "text",
            text: buildImplementPrompt(
              contract,
              planApproval.content,
              validationFeedback,
              this.promptTemplates.get("implement"),
            ),
          },
        ],
        approvalPolicy: settings.security.implementApprovalPolicy,
        approvalsReviewer: settings.security.implementApprovalsReviewer,
        model: settings.models.bugfixModel ?? null,
        effort: settings.models.bugfixReasoningEffort ?? null,
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [worktree.path],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      });
      await runtime.waitForTurnCompletion({
        idleTimeoutMs: settings.agent.implementationIdleTimeoutMs,
        maxTimeoutMs: settings.agent.implementationMaxDurationMs,
      });
      const output = runtime.getAgentText();
      this.workflow.transitionTask(taskId, "VALIDATING");
      if (this.getSystemSettings().security.bugfixAutomationMode !== "auto") {
        void this.execution.runValidations(taskId).catch((error) => {
          console.error(
            `Auto-validation failed for task ${taskId}:`,
            (error as Error).message,
          );
        });
      }
      return output;
    } catch (error) {
      if (this.tasks.get(taskId)?.status === "IMPLEMENTING") {
        this.workflow.transitionTask(taskId, "FAILED");
      }
      throw error;
    } finally {
      this.untrackRuntime(taskId, runtime);
      detach();
      runtime.close();
    }
  }

  async askPlanQuestion(taskId: string, question: string): Promise<string> {
    const task = this.requireTask(taskId);
    if (task.status !== "WAITING_FOR_PLAN_APPROVAL") {
      throw new Error(
        `Expected task status WAITING_FOR_PLAN_APPROVAL, got ${task.status}`,
      );
    }

    const contract = this.tasks.getContract(taskId);
    if (!contract) {
      throw new Error("Task contract not found");
    }
    const planApproval = this.plans.getLatest(taskId);
    if (!planApproval || planApproval.status !== "PENDING") {
      throw new Error("No pending repair plan");
    }
    const worktree = this.worktrees.getByTaskId(taskId);
    if (!worktree || worktree.status !== "READY") {
      throw new Error("Worktree not ready");
    }
    const session = this.sessions.getLatest(taskId);
    if (!session) {
      throw new Error("No analysis session");
    }

    const project = this.projects.get(task.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    const developerInstructions = await loadInstructionSources({
      repoPath: project.repoPath,
      worktreePath: worktree.path,
      instructionSources: project.instructionSources,
    });

    const runtime = new AppServerRuntime({
      codexBin: this.getCodexBin(),
      cwd: worktree.path,
      approvalMode: "decline",
    }).start();
    this.trackRuntime(taskId, runtime);
    const detach = new RuntimeEventRecorder(
      this.events,
      taskId,
      undefined,
      "plan",
    ).attach(runtime);

    try {
      await runtime.initialize({
        name: "bugfix-harness",
        title: "Bugfix Harness",
        version: "0.1.0",
      });
      await this.resumeThreadWithRetry(runtime, session.codexThreadId, {
        approvalPolicy: "never",
        approvalsReviewer: "auto-review",
        developerInstructions: developerInstructions || undefined,
      });
      await runtime.startTurn({
        threadId: session.codexThreadId,
        input: [
          {
            type: "text",
            text: buildPlanQuestionPrompt(
              contract,
              planApproval.content,
              question.trim(),
              this.promptTemplates.get("planQuestion"),
            ),
          },
        ],
        approvalPolicy: "never",
        approvalsReviewer: "auto-review",
      });
      await runtime.waitForTurnCompletion(null);
      return runtime.getAgentText();
    } finally {
      this.untrackRuntime(taskId, runtime);
      detach();
      runtime.close();
    }
  }

  private requireTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }
    return task;
  }
}
