import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

let repoPath = "";
let projectId = "";

test.beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), "bugfix-harness-e2e-repo-"));
  execFileSync("git", ["init", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "e2e@example.com"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "E2E"]);
  writeFileSync(join(repoPath, "README.md"), "# e2e fixture\n");
  execFileSync("git", ["-C", repoPath, "add", "README.md"]);
  execFileSync("git", ["-C", repoPath, "commit", "-m", "baseline"]);
});

test("backend health endpoint is reachable", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4317/api/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ ok: true });
});

test("create a project through the web UI", async ({ page }) => {
  await page.goto("/projects/new");
  await page.getByLabel("名称").fill("Playwright Project");
  await page.getByLabel("Git 仓库路径").fill(repoPath);
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText("Playwright Project")).toBeVisible();
});

test("create a bugfix task through the web UI", async ({ page, request }) => {
  const projects = await request.get("http://127.0.0.1:4317/api/projects");
  const list = (await projects.json()) as Array<{ id: string }>;
  projectId = list[0].id;

  await page.goto("/tasks/new");
  await page.getByLabel("项目").selectOption(projectId);
  await page
    .getByLabel("问题描述")
    .fill("The application fails when reading README.md");
  await page.getByRole("button", { name: "创建" }).click();

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", {
      name: "The application fails when reading README.md",
    }),
  ).toBeVisible();
});

test("task detail pages and API reflect the created task", async ({
  page,
  request,
}) => {
  const projects = await request.get("http://127.0.0.1:4317/api/projects");
  const projectList = (await projects.json()) as Array<{ id: string }>;
  const currentProjectId = projectList[0].id;
  const tasks = await request.get(
    `http://127.0.0.1:4317/api/tasks?projectId=${currentProjectId}`,
  );
  const taskList = (await tasks.json()) as Array<{ id: string }>;
  const taskId = taskList[0].id;

  const response = await request.get(`http://127.0.0.1:4317/api/tasks/${taskId}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { task: { status: string } };
  expect(body.task.status).toBe("DRAFT");

  await page.goto(`/tasks/${taskId}/plan`);
  await expect(page.getByRole("heading", { name: "修复计划" })).toBeVisible();
  await page.goto(`/tasks/${taskId}/approvals`);
  await expect(page.getByRole("heading", { name: "操作审批" })).toBeVisible();
  await page.goto(`/tasks/${taskId}/diff`);
  await expect(page.getByRole("heading", { name: "变更与检查" })).toBeVisible();
  await page.goto(`/tasks/${taskId}/report`);
  await expect(page.getByRole("heading", { name: "验收报告" })).toBeVisible();
});

test("prepare an isolated worktree through the backend API", async ({
  request,
}) => {
  const projects = await request.get("http://127.0.0.1:4317/api/projects");
  const list = (await projects.json()) as Array<{ id: string }>;
  projectId = list[0].id;

  const tasks = await request.get(
    `http://127.0.0.1:4317/api/tasks?projectId=${projectId}`,
  );
  const taskList = (await tasks.json()) as Array<{ id: string }>;
  const taskId = taskList[0].id;

  const response = await request.post(
    `http://127.0.0.1:4317/api/tasks/${taskId}/prepare-worktree`,
  );
  expect(response.ok()).toBeTruthy();
  const worktree = (await response.json()) as { status: string };
  expect(worktree.status).toBe("READY");
});

test("unknown task displays an error state", async ({ page }) => {
  await page.goto("/tasks/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText(/加载失败/)).toBeVisible();
});
