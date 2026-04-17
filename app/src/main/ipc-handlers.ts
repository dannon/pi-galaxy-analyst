import { ipcMain, dialog, BrowserWindow, shell } from "electron";
import type { AgentManager } from "./agent.js";
import path from "node:path";
import { loadConfig, saveConfig, type LoomConfig } from "./config.js";

function log(...args: unknown[]): void {
  console.log("[ipc]", ...args);
}

export function registerIpcHandlers(agent: AgentManager): void {
  ipcMain.handle("agent:prompt", async (_e, message: string) => {
    log("prompt:", message.slice(0, 80));
    agent.send({ type: "prompt", message });
  });

  ipcMain.handle("agent:abort", async () => {
    log("abort");
    agent.send({ type: "abort" });
  });

  ipcMain.handle("agent:new-session", async () => {
    log("new-session");
    return agent.sendCommand({ type: "new_session" });
  });

  ipcMain.handle("agent:get-state", async () => {
    return agent.sendCommand({ type: "get_state" });
  });

  ipcMain.on("agent:ui-response", (_e, response: Record<string, unknown>) => {
    log("ui-response:", JSON.stringify(response).slice(0, 120));
    agent.send(response);
  });

  ipcMain.handle("agent:restart", async () => {
    log("restart");
    agent.stop();
    agent.start();
  });

  ipcMain.handle("agent:reset-session", async () => {
    log("reset session — fresh start, no --continue");
    agent.stop();
    agent.resetSession();
    agent.start();
  });

  ipcMain.handle("agent:get-cwd", () => {
    return agent.getCwd();
  });

  ipcMain.handle("dialog:browse-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose directory",
      defaultPath: agent.getCwd(),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:select-directory", async (e) => {
    const result = await dialog.showOpenDialog({
      title: "Choose working directory",
      defaultPath: agent.getCwd(),
      properties: ["openDirectory", "createDirectory"],
    });
    const dir = result.filePaths[0] ?? null;
    if (dir && agent.switchCwd(dir)) {
      log("directory changed to:", dir);
      // Mirror the File > Open Analysis Directory path so the renderer
      // resets its UI when the cwd changes via the top-bar "change" button.
      BrowserWindow.fromWebContents(e.sender)?.webContents.send(
        "agent:cwd-changed",
        dir,
      );
    }
    return dir;
  });

  ipcMain.handle("config:get", () => {
    return loadConfig();
  });

  ipcMain.handle("config:save", async (_e, config: LoomConfig) => {
    try {
      saveConfig(config);
      log("config saved");
      // Restart agent subprocess to pick up new provider/model/API key
      agent.stop();
      agent.start();
      return { success: true };
    } catch (err) {
      log("config:save failed:", err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("file:open", async (_e, filePath: string) => {
    log("open file:", filePath);
    const ext = path.extname(filePath).toLowerCase();
    // HTML files → new Electron window (so user can view reports)
    if (ext === ".html" || ext === ".htm") {
      const win = new BrowserWindow({
        width: 1200,
        height: 900,
        title: path.basename(filePath),
        webPreferences: { sandbox: true },
      });
      await win.loadURL("file://" + filePath);
      return { opened: true };
    }
    // Everything else → system default app
    const err = await shell.openPath(filePath);
    if (err) return { opened: false, error: err };
    return { opened: true };
  });
}
