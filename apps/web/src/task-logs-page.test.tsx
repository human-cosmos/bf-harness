import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TaskLogEntry } from "./api.js";
import { TaskLogsPage } from "./task-logs-page.js";

vi.mock("./api.js", () => {
  return {
    api: {
      listTaskLogs: vi.fn(),
    },
  };
});

vi.mock("./use-workflow-state.js", () => {
  return {
    useWorkflowState: () => ({
      state: {
        task: {
          id: "task-1",
          projectId: "project-1",
          title: "示例任务",
          bugDescription: "示例问题",
          observedBehavior: "",
          expectedBehavior: "",
          relatedFiles: [],
          acceptanceCriteria: [],
          constraints: [],
          status: "IMPLEMENTING",
          createdAt: "2026-08-29T00:00:00.000Z",
          updatedAt: "2026-08-29T00:00:00.000Z",
        },
        project: null,
        worktree: null,
        attention: {
          taskId: "task-1",
          clarification: null,
          planApproval: null,
          pendingApprovals: 0,
          validation: { passed: 0, failed: 0, timeout: 0, skipped: 0 },
        },
        planApproval: null,
        pendingApprovals: [],
        validations: [],
        report: null,
        diff: null,
        jobs: [],
      },
      loading: false,
      error: "",
      refresh: vi.fn(),
      setState: vi.fn(),
    }),
  };
});

const logs: TaskLogEntry[] = [
  {
    id: 1,
    taskId: "task-1",
    seq: 1,
    level: "info",
    source: "workflow",
    phase: "lifecycle",
    method: "task.status_changed",
    message: "任务状态更新为：IMPLEMENTING",
    payload: { status: "IMPLEMENTING" },
    codexThreadId: null,
    codexTurnId: null,
    codexItemId: null,
    emittedAtMs: null,
    createdAt: "2026-08-29T00:00:00.000Z",
  },
];

import { api } from "./api.js";

describe("TaskLogsPage", () => {
  it("renders logs and expands raw details", async () => {
    const listTaskLogs = vi.mocked(api.listTaskLogs);
    listTaskLogs.mockResolvedValue({
      items: logs,
      nextAfterSeq: null,
    });

    render(
      <MemoryRouter initialEntries={["/tasks/task-1/logs"]}>
        <Routes>
          <Route path="/tasks/:id/logs" element={<TaskLogsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("任务状态更新为：IMPLEMENTING")).toBeTruthy();
    expect(screen.getByText("运行日志")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: /任务状态更新为：IMPLEMENTING/,
      }),
    );
    expect(await screen.findByText(/"payload"/)).toBeTruthy();
  });

  it("loads more logs with the next cursor", async () => {
    const listTaskLogs = vi.mocked(api.listTaskLogs);
    listTaskLogs
      .mockResolvedValueOnce({
        items: logs,
        nextAfterSeq: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...logs[0],
            id: 2,
            seq: 2,
            method: "job.completed",
            message: "后台任务完成：运行检查",
            payload: { kind: "validate" },
          },
        ],
        nextAfterSeq: null,
      });

    render(
      <MemoryRouter initialEntries={["/tasks/task-1/logs"]}>
        <Routes>
          <Route path="/tasks/:id/logs" element={<TaskLogsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("任务状态更新为：IMPLEMENTING")).toBeTruthy();
    fireEvent.click(screen.getByText("加载更多"));
    expect(await screen.findByText("后台任务完成：运行检查")).toBeTruthy();
  });
});
