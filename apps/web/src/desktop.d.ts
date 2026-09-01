interface DesktopApi {
  selectFolder: () => Promise<string | null>;
  selectFile: () => Promise<string | null>;
  setApiKey: (apiKey: string) => Promise<{ ok: boolean }>;
  getAuthStatus: () => Promise<{
    authenticated: boolean;
    authFile: string;
    codexHome: string;
  }>;
  setTheme: (theme: "light" | "dark") => Promise<{ ok: boolean }>;
  getRuntimeStatus: () => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
