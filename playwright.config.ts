import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testHome = mkdtempSync(join(tmpdir(), "bugfix-harness-playwright-"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4318",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @bugfix-harness/server start",
      url: "http://127.0.0.1:4317/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        BUGFIX_HARNESS_HOME: testHome,
        BUGFIX_HARNESS_PORT: "4317",
        BUGFIX_HARNESS_HOST: "127.0.0.1",
      },
    },
    {
      command: "pnpm --filter @bugfix-harness/web dev --host 127.0.0.1",
      url: "http://127.0.0.1:4318",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
      },
    },
  ],
});
