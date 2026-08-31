import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_SYSTEM_SETTINGS } from "@bugfix-harness/shared";
import { SettingsPage } from "./system-settings-page.js";
import { api, type CodexRuntimeInfo } from "./api.js";

vi.mock("./api.js", () => ({
  api: {
    getSystemSettings: vi.fn(),
    saveSystemSettings: vi.fn(),
    resetSystemSettings: vi.fn(),
    diagnostics: vi.fn(),
    getPromptTemplates: vi.fn(),
    savePromptTemplates: vi.fn(),
    resetPromptTemplates: vi.fn(),
    getCodexRuntime: vi.fn(),
    saveCodexRuntime: vi.fn(),
    pickCodexFile: vi.fn(),
  },
}));

const runtimeInfo: CodexRuntimeInfo = {
  runtimeCommand: "codex-harness app-server --stdio",
  codexBin: "/usr/local/bin/codex",
  source: "path",
  available: true,
  version: "codex 0.1.0",
  candidates: [
    {
      path: "/usr/local/bin/codex",
      source: "path",
      available: true,
      version: "codex 0.1.0",
    },
  ],
};

describe("SettingsPage", () => {
  it("shows the detected Codex version", async () => {
    vi.mocked(api.getSystemSettings).mockResolvedValue({
      settings: DEFAULT_SYSTEM_SETTINGS,
      defaults: DEFAULT_SYSTEM_SETTINGS,
    });
    vi.mocked(api.diagnostics).mockResolvedValue({
      runtime: "codex-harness app-server --stdio",
      dataHome: "~/.bugfix-harness",
      settings: DEFAULT_SYSTEM_SETTINGS,
      disk: {
        warn: false,
        totalBytes: 100,
        freeBytes: 40,
        usedRatio: 0.6,
      },
    });
    vi.mocked(api.getPromptTemplates).mockResolvedValue([]);
    vi.mocked(api.getCodexRuntime).mockResolvedValue(runtimeInfo);

    render(<SettingsPage />);

    expect(await screen.findByText("codex 0.1.0")).toBeTruthy();
  });
});
