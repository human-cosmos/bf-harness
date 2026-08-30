import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test.setTimeout(600_000);

let repoPath = "";
let projectId = "";
let taskId = "";

test.beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), "bugfix-harness-ai-e2e-repo-"));
  execFileSync("git", ["init", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "e2e@example.com"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "E2E"]);
  writeFileSync(join(repoPath, "README.md"), "# AI e2e fixture\n");
  execFileSync("git", ["-C", repoPath, "add", "README.md"]);
  execFileSync("git", ["-C", repoPath, "commit", "-m", "baseline"]);
});

test("complete AI bugfix main flow through the web UI", async ({
  page,
  request,
}) => {
  const projectResponse = await request.post(
    "http://127.0.0.1:4317/api/projects",
    {
      data: {
        name: "AI E2E Project",
        repoPath,
        instructionSources: [],
        validationCommands: [
          {
            id: "echo",
            label: "Echo",
            command: ["echo", "accepted"],
            timeoutSec: 30,
          },
        ],
        allowedPaths: [repoPath],
        forbiddenPaths: [],
      },
    },
  );
  expect(projectResponse.ok()).toBeTruthy();
  projectId = ((await projectResponse.json()) as { id: string }).id;

  await page.goto("/tasks/new");
  await page.getByLabel("项目").selectOption(projectId);
  await page
    .getByLabel("问题描述", { exact: true })
    .fill("Create a result.txt file containing exactly AI_E2E_OK.");
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  taskId = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "开始修复" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4317/api/tasks/${taskId}`,
      );
      const body = (await response.json()) as { task: { status: string } };
      return body.task.status;
    }, { timeout: 300_000 })
    .toBe("WAITING_FOR_PLAN_APPROVAL");

  await page.goto(`/tasks/${taskId}/plan`);
  await expect(
    page.getByRole("heading", { name: "修复计划", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "仅批准" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "仅批准" }).click();

  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4317/api/tasks/${taskId}`,
      );
      const body = (await response.json()) as { task: { status: string } };
      return body.task.status;
    }, { timeout: 300_000 })
    .toBe("IMPLEMENTING");

  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: "开始实施" }).click();

  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4317/api/tasks/${taskId}`,
      );
      const body = (await response.json()) as { task: { status: string } };
      return body.task.status;
    }, { timeout: 300_000 })
    .toMatch(/^(VALIDATING|WAITING_FOR_ACCEPTANCE)$/);

  await page.goto(`/tasks/${taskId}/diff`);
  await page.getByRole("button", { name: "运行检查" }).click();

  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4317/api/tasks/${taskId}`,
      );
      const body = (await response.json()) as { task: { status: string } };
      return body.task.status;
    }, { timeout: 300_000 })
    .toBe("WAITING_FOR_ACCEPTANCE");

  await page.goto(`/tasks/${taskId}/report`);
  await page.getByRole("button", { name: "生成验收报告" }).click();
  await expect(page.getByRole("button", { name: "通过" })).toBeEnabled({
    timeout: 300_000,
  });
  await page.getByRole("button", { name: "通过" }).click();

  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4317/api/tasks/${taskId}`,
      );
      const body = (await response.json()) as { task: { status: string } };
      return body.task.status;
    }, { timeout: 300_000 })
    .toBe("ACCEPTED");
});
