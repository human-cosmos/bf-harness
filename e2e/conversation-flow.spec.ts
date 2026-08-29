import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

let repoPath = "";

test.beforeAll(() => {
  repoPath = mkdtempSync(join(tmpdir(), "bugfix-harness-chat-e2e-"));
  execFileSync("git", ["init", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "chat-e2e@example.com"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Chat E2E"]);
  writeFileSync(join(repoPath, "README.md"), "# chat e2e\n");
  execFileSync("git", ["-C", repoPath, "add", "README.md"]);
  execFileSync("git", ["-C", repoPath, "commit", "-m", "baseline"]);
});

test("project chat list and detail pages are reachable", async ({
  page,
  request,
}) => {
  const projectResponse = await request.post(
    "http://127.0.0.1:4317/api/projects",
    {
      data: {
        name: "Conversation E2E Project",
        repoPath,
        instructionSources: [],
        validationCommands: [],
        allowedPaths: [],
        forbiddenPaths: [],
      },
    },
  );
  expect(projectResponse.ok()).toBeTruthy();
  const project = (await projectResponse.json()) as { id: string };

  const createResponse = await request.post(
    `http://127.0.0.1:4317/api/projects/${project.id}/conversations`,
    { data: { title: "Chat UI E2E" } },
  );
  expect(createResponse.ok()).toBeTruthy();
  const conversation = (await createResponse.json()) as { id: string };

  await page.goto(`/projects/${project.id}/chat`);
  await expect(page.getByRole("heading", { name: "自由对话" })).toBeVisible();
  await expect(page.getByText("Chat UI E2E")).toBeVisible();

  await page.goto(`/projects/${project.id}/chat/${conversation.id}`);
  await expect(page.getByRole("heading", { name: "Chat UI E2E" })).toBeVisible();
  await expect(page.getByLabel("对话输入")).toBeVisible();

  await page.getByRole("button", { name: "策略" }).click();
  await expect(page.getByRole("button", { name: "保存策略" })).toBeVisible();
});

test("conversation REST API returns history and events", async ({ request }) => {
  const projects = await request.get("http://127.0.0.1:4317/api/projects");
  const projectList = (await projects.json()) as Array<{ id: string }>;
  const projectId = projectList[0].id;

  const conversations = await request.get(
    `http://127.0.0.1:4317/api/projects/${projectId}/conversations`,
  );
  expect(conversations.ok()).toBeTruthy();
  const conversationList = (await conversations.json()) as Array<{ id: string }>;
  expect(conversationList.length).toBeGreaterThan(0);

  const events = await request.get(
    `http://127.0.0.1:4317/api/conversations/${conversationList[0].id}/events`,
  );
  expect(events.ok()).toBeTruthy();
  expect(Array.isArray(await events.json())).toBe(true);
});
