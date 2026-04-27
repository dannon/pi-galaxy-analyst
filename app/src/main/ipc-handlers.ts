import { ipcMain, dialog, BrowserWindow, shell } from "electron";
import type { AgentManager } from "./agent.js";
import { startFilesWatcher, resolveWithin } from "./files-handler.js";
import { loadSessionHistory } from "./session-replay.js";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, saveConfig, type LoomConfig } from "./config.js";

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

  // Replay the current session's chat transcript into the renderer. Used by
  // the /chat slash command to recover chat after the window blanks out
  // (e.g. after an accidental file:// navigation). No agent restart — just
  // re-read session.jsonl and push the ReplaySegment[] back.
  ipcMain.handle("chat:replay", async (e) => {
    const window = BrowserWindow.fromWebContents(e.sender);
    if (!window || window.isDestroyed()) return { ok: false, error: "no window" };
    try {
      const history = loadSessionHistory(agent.getCwd());
      window.webContents.send("agent:session-history", history);
      return { ok: true, segments: history.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
      if (window) startFilesWatcher(window, dir);
    }
    return dir;
  });

  ipcMain.handle("config:get", () => {
    return loadConfig();
  });

  ipcMain.handle(
    "apiKey:validate",
    async (_e, provider: string, key: string): Promise<{ valid: boolean; error?: string }> => {
      return validateApiKey(provider, key);
    },
  );

  // Top-level config keys the renderer is allowed to set. Anything else
  // submitted via config:save is dropped before saveConfig() runs — the
  // renderer is the smaller trust boundary, so a markdown XSS that
  // managed to call window.orbit.saveConfig should not be able to plant
  // arbitrary keys (which would be picked up after the brain restart at
  // the bottom of this handler).
  const ALLOWED_CONFIG_KEYS: ReadonlySet<string> = new Set([
    "llm",
    "galaxy",
    "executionMode",
    "defaultCwd",
    "skills",
    "condaBin",
    "experiments",
  ]);

  function sanitizeConfig(input: unknown): LoomConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("config:save expects an object payload");
    }
    const out: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (ALLOWED_CONFIG_KEYS.has(k)) {
        out[k] = v;
      } else {
        dropped.push(k);
      }
    }
    if (dropped.length > 0) {
      log("config:save dropped unknown keys:", dropped);
    }
    return out as LoomConfig;
  }

  ipcMain.handle("config:save", async (_e, config: LoomConfig) => {
    try {
      const safe = sanitizeConfig(config);
      saveConfig(safe);
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

  ipcMain.handle("notebook:status", (): { exists: boolean; hasContent: boolean } => {
    const notebookPath = path.join(agent.getCwd(), "notebook.md");
    if (!fs.existsSync(notebookPath)) return { exists: false, hasContent: false };
    try {
      const stat = fs.statSync(notebookPath);
      return { exists: true, hasContent: stat.size > 0 };
    } catch {
      return { exists: true, hasContent: false };
    }
  });

  ipcMain.handle("notebook:clear-artifacts", async (): Promise<{ cleared: boolean; error?: string }> => {
    const cwd = agent.getCwd();
    const targets = ["notebook.md", "activity.jsonl", "session.jsonl"];
    const removed: string[] = [];
    try {
      for (const name of targets) {
        const p = path.join(cwd, name);
        try {
          const stat = fs.lstatSync(p);
          if (stat.isSymbolicLink() || stat.isFile()) {
            fs.rmSync(p);
            removed.push(name);
          }
        } catch {
          // file didn't exist -- skip
        }
      }
      if (removed.length > 0) {
        try {
          execSync(`git add -A ${removed.map((n) => `"${n}"`).join(" ")}`, { cwd, stdio: "ignore" });
          execSync('git commit -m "Cleared previous analysis"', { cwd, stdio: "ignore" });
        } catch {
          // git not available or nothing to commit -- best effort
        }
      }
      return { cleared: true };
    } catch (err) {
      log("notebook:clear-artifacts failed:", err);
      return { cleared: false, error: String(err) };
    }
  });

  ipcMain.handle("file:open", async (_e, filePath: string) => {
    log("open file:", filePath);

    // Path clamp: the renderer can pass any string here, including paths
    // outside the analysis cwd. Always go through resolveWithin so a
    // markdown link or compromised renderer can't ask us to open
    // /etc/passwd or a privileged HTML file in a new BrowserWindow.
    let absPath: string;
    try {
      absPath = resolveWithin(agent.getCwd(), filePath);
    } catch (err) {
      log("file:open rejected — escapes cwd:", filePath);
      return { opened: false, error: String(err) };
    }
    const ext = path.extname(absPath).toLowerCase();

    // HTML files → new Electron window (so user can view reports)
    if (ext === ".html" || ext === ".htm") {
      const win = new BrowserWindow({
        width: 1200,
        height: 900,
        title: path.basename(absPath),
        webPreferences: {
          // Hardened: no preload bridge, no Node, sandbox on, web
          // security on, isolated context. The opened HTML is treated
          // like any untrusted web page.
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      await win.loadFile(absPath);
      return { opened: true };
    }
    // Everything else → system default app
    const err = await shell.openPath(absPath);
    if (err) return { opened: false, error: err };
    return { opened: true };
  });
}

/**
 * Live API key validation. Makes a minimal request against the provider's
 * auth-gated endpoint and maps the response to a pass/fail result.
 *
 * We trade speed for correctness: format checks alone can't distinguish a
 * revoked key from a valid one, so for providers whose format collisions
 * matter (anthropic, openai) we actually hit the network. 5s timeout.
 */
async function validateApiKey(
  provider: string,
  key: string,
): Promise<{ valid: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { valid: false, error: "Key is empty" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    if (provider === "anthropic") {
      if (!trimmed.startsWith("sk-ant-")) {
        return { valid: false, error: "Anthropic keys start with sk-ant-" };
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": trimmed,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: controller.signal,
      });
      if (res.status === 401) return { valid: false, error: "Invalid API key (401)" };
      if (res.ok || res.status === 400) return { valid: true };
      return { valid: false, error: `Unexpected response: HTTP ${res.status}` };
    }
    if (provider === "openai") {
      if (!trimmed.startsWith("sk-")) {
        return { valid: false, error: "OpenAI keys start with sk-" };
      }
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${trimmed}` },
        signal: controller.signal,
      });
      if (res.status === 401) return { valid: false, error: "Invalid API key (401)" };
      if (res.ok) return { valid: true };
      return { valid: false, error: `Unexpected response: HTTP ${res.status}` };
    }
    // For providers we don't live-check, just sanity-check length so at least
    // paste-of-garbage (e.g. terminal output) gets caught.
    if (trimmed.length < 16 || trimmed.length > 400 || /\s/.test(trimmed)) {
      return { valid: false, error: "Key looks malformed" };
    }
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) return { valid: false, error: "Validation timed out" };
    return { valid: false, error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
