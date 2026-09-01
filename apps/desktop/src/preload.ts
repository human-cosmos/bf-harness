import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  selectFile: () => ipcRenderer.invoke("dialog:select-file"),
  setApiKey: (apiKey: string) => ipcRenderer.invoke("codex:set-api-key", apiKey),
  getAuthStatus: () => ipcRenderer.invoke("codex:get-auth-status"),
  setTheme: (theme: "light" | "dark") =>
    ipcRenderer.invoke("window:set-theme", theme),
  getRuntimeStatus: () => ipcRenderer.invoke("runtime:status"),
});
