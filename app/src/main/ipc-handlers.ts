import { ipcMain, dialog, BrowserWindow, shell } from "electron";
import type { AgentManager } from "./agent.js";
import path from "node:path";
import { loadConfig, saveConfig, type LoomConfig } from "./config.js";
import { encryptSecret, isAvailable as safeStorageAvailable } from "./secure-config.js";

/**
 * Sentinel the renderer sends back in a secret field when the user did NOT
 * change it. Main preserves whatever is already on disk in that case.
 */
export const UNCHANGED_SECRET = "__loom_unchanged_secret__";

/** Masked shape returned to the renderer — never carries plaintext secrets. */
interface MaskedLoomConfig extends Omit<LoomConfig, "llm" | "galaxy"> {
  llm?: {
    provider?: string;
    model?: string;
    hasApiKey: boolean;
  };
  galaxy?: {
    active: string | null;
    profiles: Record<string, { url: string; hasApiKey: boolean }>;
  };
}

function maskConfig(cfg: LoomConfig): MaskedLoomConfig {
  const { llm: _llm, galaxy: _galaxy, ...rest } = cfg;
  const masked: MaskedLoomConfig = { ...rest };
  if (cfg.llm) {
    masked.llm = {
      provider: cfg.llm.provider,
      model: cfg.llm.model,
      hasApiKey: Boolean(cfg.llm.apiKey || cfg.llm.apiKeyEncrypted),
    };
  }
  if (cfg.galaxy) {
    masked.galaxy = {
      active: cfg.galaxy.active,
      profiles: Object.fromEntries(
        Object.entries(cfg.galaxy.profiles).map(([k, v]) => [
          k,
          { url: v.url, hasApiKey: Boolean(v.apiKey || v.apiKeyEncrypted) },
        ])
      ),
    };
  }
  return masked;
}

/**
 * Reconcile the renderer-supplied config against what's on disk, encrypting
 * any newly-supplied plaintext secrets and preserving unchanged ones.
 */
function reconcileIncomingConfig(incoming: Record<string, unknown>): LoomConfig {
  const current = loadConfig();
  const canEncrypt = safeStorageAvailable();
  const out: LoomConfig = { ...current, ...(incoming as LoomConfig) };

  // LLM key reconciliation
  const incomingLlm = (incoming as { llm?: { apiKey?: string } }).llm;
  if (incomingLlm) {
    const rawKey = incomingLlm.apiKey;
    const mergedLlm: LoomConfig["llm"] = {
      provider: (incoming as { llm?: { provider?: string } }).llm?.provider,
      model: (incoming as { llm?: { model?: string } }).llm?.model,
    };
    if (rawKey === UNCHANGED_SECRET || rawKey === undefined) {
      // Preserve whatever was on disk.
      if (current.llm?.apiKeyEncrypted) mergedLlm.apiKeyEncrypted = current.llm.apiKeyEncrypted;
      if (current.llm?.apiKey) mergedLlm.apiKey = current.llm.apiKey;
    } else if (rawKey === "") {
      // Explicit clear — drop both fields.
    } else if (canEncrypt) {
      mergedLlm.apiKeyEncrypted = encryptSecret(rawKey);
    } else {
      mergedLlm.apiKey = rawKey;
    }
    out.llm = mergedLlm;
  }

  // Galaxy profile reconciliation (per profile)
  type GalaxyConfig = NonNullable<LoomConfig["galaxy"]>;
  const incomingGalaxy = (incoming as { galaxy?: GalaxyConfig }).galaxy;
  if (incomingGalaxy) {
    const mergedProfiles: GalaxyConfig["profiles"] = {};
    for (const [name, p] of Object.entries(incomingGalaxy.profiles || {})) {
      const existing = current.galaxy?.profiles?.[name];
      const rawKey = p.apiKey;
      const profile: (typeof mergedProfiles)[string] = { url: p.url };
      if (rawKey === UNCHANGED_SECRET || rawKey === undefined) {
        if (existing?.apiKeyEncrypted) profile.apiKeyEncrypted = existing.apiKeyEncrypted;
        if (existing?.apiKey) profile.apiKey = existing.apiKey;
      } else if (rawKey === "") {
        // Explicit clear — drop both fields.
      } else if (canEncrypt) {
        profile.apiKeyEncrypted = encryptSecret(rawKey);
      } else {
        profile.apiKey = rawKey;
      }
      mergedProfiles[name] = profile;
    }
    out.galaxy = { active: incomingGalaxy.active, profiles: mergedProfiles };
  }

  return out;
}

function log(...args: unknown[]): void {
  console.log("[ipc]", ...args);
}

/**
 * Ask the user to confirm that switching analysis directories will start
 * a fresh agent session and clear the current chat/plan/notebook view.
 * Returns true if the user confirmed.
 */
export async function confirmCwdChange(window?: BrowserWindow): Promise<boolean> {
  const result = await dialog.showMessageBox(window!, {
    type: "warning",
    buttons: ["Cancel", "Continue"],
    defaultId: 0,
    cancelId: 0,
    title: "Change analysis directory?",
    message: "Changing the analysis directory will start a new agent session.",
    detail:
      "The current chat, plan, and notebook view will be cleared from this window. The previous session remains on disk and can be resumed by opening that directory again.",
  });
  return result.response === 1;
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
    const window = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    if (!(await confirmCwdChange(window))) return null;
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
      window?.webContents.send("agent:cwd-changed", dir);
    }
    return dir;
  });

  ipcMain.handle("config:get", () => {
    return maskConfig(loadConfig());
  });

  ipcMain.handle("config:save", async (_e, incoming: Record<string, unknown>) => {
    try {
      const reconciled = reconcileIncomingConfig(incoming);
      saveConfig(reconciled);
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
