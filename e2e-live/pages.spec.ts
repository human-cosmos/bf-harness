import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

const API = "http://127.0.0.1:4317";

function makeRepo(seed: string): string {
  const repoPath = mkdtempSync(join(tmpdir(), `bfh-live-${seed}-`));
  execFileSync("git", ["init", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "live@example.com"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Live E2E"]);
  writeFileSync(join(repoPath, "README.md"), `# ${seed}\n`);
  execFileSync("git", ["-C", repoPath, "add", "README.md"]);
  execFileSync("git", ["-C", repoPath, "commit", "-m", "baseline"]);
  return repoPath;
}

async function createProject(
  request: APIRequestContext,
  name: string,
  repoPath: string,
): Promise<string> {
  const response = await request.post(`${API}/api/projects`, {
    data: {
      name,
      repoPath,
      instructionSources: [],
      validationCommands: [
        { id: "echo", label: "Echo", command: ["echo", "ok"], timeoutSec: 30 },
      ],
      allowedPaths: [],
      forbiddenPaths: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  const project = (await response.json()) as { id: string };
  return project.id;
}

async function deleteProject(request: APIRequestContext, id: string) {
  await request.delete(`${API}/api/projects/${id}`);
}

const createdProjectIds: string[] = [];

test.afterAll(async ({ request }) => {
  for (const id of createdProjectIds) {
    await request.delete(`${API}/api/projects/${id}`);
  }
});

test("E2E-01 基础与导航", async ({ page, request }) => {
  const health = await request.get(`${API}/api/health`);
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toEqual({ ok: true });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "本地项目" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page).toHaveTitle(/bf-harness/);

  await page.getByRole("link", { name: "待办" }).click();
  await expect(page.getByRole("heading", { name: "待办中心" })).toBeVisible();
  await page.getByRole("link", { name: "任务" }).click();
  await expect(page.getByRole("heading", { name: "新建 Bugfix 任务" })).toBeVisible();
  await page.getByRole("link", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
});

test("E2E-02 项目列表与删除", async ({ page, request }) => {
  const repoPath = makeRepo("projects");
  const projectId = await createProject(request, "Live Project List", repoPath);
  createdProjectIds.push(projectId);

  await page.goto("/");
  await expect(page.getByText("Live Project List")).toBeVisible();
  await expect(page.getByText(repoPath)).toBeVisible();

  const row = page.locator(".list-item", { hasText: "Live Project List" });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.locator(".list-item-title", { hasText: "Live Project List" }),
  ).not.toBeVisible();
  createdProjectIds.splice(createdProjectIds.indexOf(projectId), 1);
});

test("E2E-03 添加本地项目表单校验", async ({ page, request }) => {
  const repoPath = makeRepo("newproject");

  await page.goto("/projects/new");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByLabel("名称")).toBeVisible();
  await expect(page.getByLabel("Git 仓库路径")).toBeVisible();

  await page.getByLabel("名称").fill("Live New Project");
  await page.getByLabel("Git 仓库路径").fill("/not/a/repo");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".notice-error")).toBeVisible();

  await page.getByLabel("Git 仓库路径").fill(repoPath);
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Live New Project")).toBeVisible();

  const projects = (await (await request.get(`${API}/api/projects`)).json()) as Array<{
    id: string;
    name: string;
  }>;
  const created = projects.find((project) => project.name === "Live New Project");
  expect(created).toBeTruthy();
  if (created) {
    createdProjectIds.push(created.id);
  }
});

test("E2E-04 添加远程项目表单校验", async ({ page }) => {
  await page.goto("/projects/new");
  await page.getByRole("radio", { name: "远程仓库（GitHub / GitLab）" }).check();
  await expect(page.getByLabel("仓库地址")).toBeVisible();
  await expect(page.getByLabel("用户名")).toBeVisible();
  await expect(page.getByLabel("密码或令牌")).toBeVisible();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page).toHaveURL(/projects\/new/);
  await expect(page.getByLabel("仓库地址")).toBeVisible();
});

test("E2E-05 项目任务列表", async ({ page, request }) => {
  const repoPath = makeRepo("projecttasks");
  const projectId = await createProject(request, "Live Project Tasks", repoPath);
  createdProjectIds.push(projectId);

  const taskResponse = await request.post(`${API}/api/tasks`, {
    data: {
      projectId,
      bugDescription: "A task shown in the project page",
      observedBehavior: "broken",
      expectedBehavior: "fixed",
      acceptanceCriteria: ["works"],
      constraints: [],
    },
  });
  expect(taskResponse.ok()).toBeTruthy();

  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: "项目任务" })).toBeVisible();
  await expect(page.getByText("A task shown in the project page")).toBeVisible();

  await page.getByRole("button", { name: /进行中/ }).click();
  await expect(page.getByText("暂无任务。")).toBeVisible();
  await page.getByRole("button", { name: /全部/ }).click();
  await expect(page.getByText("A task shown in the project page")).toBeVisible();
});

test("E2E-06 待办中心空态", async ({ page }) => {
  await page.goto("/pending");
  await expect(page.getByRole("heading", { name: "待办中心" })).toBeVisible();
  await expect(page.getByText(/当前没有需要你处理的任务。/)).toBeVisible();
});

test("E2E-07 新建任务表单校验与创建", async ({ page, request }) => {
  const repoPath = makeRepo("newtask");
  const projectId = await createProject(request, "Live New Task Project", repoPath);
  createdProjectIds.push(projectId);

  await page.goto(`/tasks/new?projectId=${projectId}`);
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByLabel("问题描述", { exact: true })).toBeVisible();

  await page
    .getByLabel("问题描述", { exact: true })
    .fill("Create a result.txt containing LIVE_OK.");
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "Create a result.txt containing LIVE_OK." }),
  ).toBeVisible();
});

test("E2E-08 任务详情与删除", async ({ page, request }) => {
  const repoPath = makeRepo("taskdetail");
  const projectId = await createProject(request, "Live Task Detail Project", repoPath);
  createdProjectIds.push(projectId);

  const taskResponse = await request.post(`${API}/api/tasks`, {
    data: {
      projectId,
      bugDescription: "Task detail smoke",
      observedBehavior: "broken",
      expectedBehavior: "fixed",
      acceptanceCriteria: [],
      constraints: [],
    },
  });
  const { task } = (await taskResponse.json()) as { task: { id: string; status: string } };
  expect(task.status).toBe("DRAFT");

  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole("heading", { name: "Task detail smoke" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始修复" })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除任务" })).toBeVisible();

  await page.getByRole("button", { name: "删除任务" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));
});

test("E2E-13 运行日志页", async ({ page, request }) => {
  const repoPath = makeRepo("logs");
  const projectId = await createProject(request, "Live Logs Project", repoPath);
  createdProjectIds.push(projectId);

  const taskResponse = await request.post(`${API}/api/tasks`, {
    data: {
      projectId,
      bugDescription: "Logs page smoke",
      observedBehavior: "broken",
      expectedBehavior: "fixed",
      acceptanceCriteria: [],
      constraints: [],
    },
  });
  const { task } = (await taskResponse.json()) as { task: { id: string } };

  await page.goto(`/tasks/${task.id}/logs`);
  await expect(page.getByRole("heading", { name: "运行日志" })).toBeVisible();
});

test("E2E-14 系统设置页", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByText("提示词模板")).toBeVisible();
  await expect(page.getByText("运行时路径与 Codex 二进制")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存全部系统设置" })).toBeVisible();
});

test("E2E-15 自由对话列表", async ({ page, request }) => {
  const repoPath = makeRepo("chatlist");
  const projectId = await createProject(request, "Live Chat List Project", repoPath);
  createdProjectIds.push(projectId);

  await page.goto(`/projects/${projectId}/chat`);
  await expect(page.getByRole("heading", { name: "自由对话" })).toBeVisible();
  await expect(page.getByText("还没有对话")).toBeVisible();

  const createResponse = await request.post(
    `${API}/api/projects/${projectId}/conversations`,
    { data: { title: "Live Chat Smoke" } },
  );
  expect(createResponse.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText("Live Chat Smoke")).toBeVisible();
});

test("E2E-16 自由对话详情与策略", async ({ page, request }) => {
  const repoPath = makeRepo("chatdetail");
  const projectId = await createProject(request, "Live Chat Detail Project", repoPath);
  createdProjectIds.push(projectId);

  const createResponse = await request.post(
    `${API}/api/projects/${projectId}/conversations`,
    { data: { title: "Live Chat Detail" } },
  );
  const conversation = (await createResponse.json()) as { id: string };

  await page.goto(`/projects/${projectId}/chat/${conversation.id}`);
  await expect(page.getByRole("heading", { name: "Live Chat Detail" })).toBeVisible();
  await expect(page.getByLabel("对话输入")).toBeVisible();

  await page.getByRole("button", { name: "策略" }).click();
  await expect(page.getByRole("button", { name: "保存策略" })).toBeVisible();
});

test("E2E-17 错误状态", async ({ page }) => {
  await page.goto("/not-a-real-page");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();

  await page.goto("/tasks/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText(/加载失败/)).toBeVisible();
});
