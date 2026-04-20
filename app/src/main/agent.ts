import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BrowserWindow } from "electron";

// Resolve the loom entry point relative to the app
const LOOM_BIN = path.resolve(__dirname, "../../../bin/loom.js");

export type AgentStatus = "running" | "stopped" | "error";

interface PendingResponse {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

function log(...args: unknown[]): void {
  console.log("[agent]", ...args);
}

export class AgentManager {
  private process: ChildProcess | null = null;
  private window: BrowserWindow;
  private status: AgentStatus = "stopped";
  private stderr = "";
  private pendingResponses = new Map<string, PendingResponse>();
  private idCounter = 0;
  private cwd: string;
  private hasStartedBefore = false;  // → use --continue on restart to preserve chat history
  private nextStartSkipContinue = false; // → restart in a new cwd without resuming old chat
  private nextStartIsFresh = false;  // → tells extension to skip notebook auto-load on next start

  constructor(window: BrowserWindow, cwd: string) {
    this.window = window;
    this.cwd = cwd;
  }

  /** Reset session continuity (e.g. when switching to a new analysis directory). */
  resetSession(): void {
    this.hasStartedBefore = false;
    this.nextStartSkipContinue = false;
    this.nextStartIsFresh = true;
  }

  setCwd(cwd: string): void {
    if (cwd !== this.cwd) {
      // New analysis directory → fresh session, no --continue
      this.hasStartedBefore = false;
    }
    this.cwd = cwd;
    log("cwd set to", cwd);
  }

  switchCwd(cwd: string): boolean {
    if (cwd === this.cwd) return false;
    this.cwd = cwd;
    this.hasStartedBefore = false;
    this.nextStartSkipContinue = true;
    this.nextStartIsFresh = false;
    log("switching cwd to", cwd);
    if (this.process) {
      this.stop();
      this.start();
    }
    return true;
  }

  getCwd(): string {
    return this.cwd;
  }

  getPid(): number | null {
    return this.process?.pid ?? null;
  }

  /**
   * Check if Pi.dev has any saved sessions for the current cwd.
   * Pi stores sessions in ~/.pi/agent/sessions/<encoded-cwd>/ as .jsonl files.
   * Used on first launch to decide whether to pass --continue for a soft resume.
   */
  private hasExistingSession(): boolean {
    try {
      const encoded = `--${this.cwd.replace(/\//g, "-")}--`;
      const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encoded);
      if (!fs.existsSync(sessionsDir)) return false;
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
      return files.length > 0;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.process) this.stop();
    this.stderr = "";

    // Pass --continue to resume the previous session and preserve chat history:
    // - Always on restart within the same app run (model switch, prefs save)
    // - On first launch (!hasStartedBefore), only if a Pi session exists for this cwd
    // Fresh /new sessions bypass this (nextStartIsFresh → no --continue).
    const wantsContinue =
      !this.nextStartSkipContinue &&
      !this.nextStartIsFresh &&
      (this.hasStartedBefore || this.hasExistingSession());
    const args = [LOOM_BIN, "--mode", "rpc"];
    if (wantsContinue) {
      args.push("--continue");
    }
    this.hasStartedBefore = true;
    this.nextStartSkipContinue = false;

    const fresh = this.nextStartIsFresh;
    this.nextStartIsFresh = false;
    log("starting agent", { bin: LOOM_BIN, cwd: this.cwd, continue: args.includes("--continue"), fresh });

    try {
      this.process = spawn("node", args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.cwd,
        env: { ...process.env, LOOM_SHELL_KIND: "orbit", ...(fresh ? { LOOM_FRESH_SESSION: "1" } : {}) },
      });
    } catch (err) {
      log("spawn failed:", err);
      this.setStatus("error", `Failed to spawn agent: ${err}`);
      return;
    }

    log("agent spawned, pid:", this.process.pid);
    this.setStatus("running");

    const rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    rl.on("line", (line) => this.handleLine(line));

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderr += text;
      log("stderr:", text.trimEnd());
    });

    // Capture the spawned process so the exit handler doesn't clobber a newer one
    // (race: stop() spawns a new process, then the OLD process's exit fires later
    // and wipes this.process to null even though the new one is alive).
    const spawnedProcess = this.process;

    spawnedProcess.on("exit", (code, signal) => {
      log("agent exited, code:", code, "signal:", signal, "pid:", spawnedProcess.pid);
      if (this.process === spawnedProcess) {
        this.process = null;
        if (code !== 0 && code !== null) {
          this.setStatus("error", `Agent exited with code ${code}`);
        } else {
          this.setStatus("stopped");
        }
      } else {
        log("(stale exit — newer agent already running, ignoring)");
      }
    });

    spawnedProcess.on("error", (err) => {
      log("agent process error:", err.message, "pid:", spawnedProcess.pid);
      if (this.process === spawnedProcess) {
        this.process = null;
        this.setStatus("error", err.message);
      }
    });
  }

  stop(): void {
    if (this.process) {
      log("stopping agent, pid:", this.process.pid);
      // Detach all listeners so any delayed exit/error events from THIS process
      // can't fire after start() spawns a replacement.
      this.process.removeAllListeners();
      this.process.stdout?.removeAllListeners();
      this.process.stderr?.removeAllListeners();
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.setStatus("stopped");
    for (const [id, pending] of this.pendingResponses) {
      log("rejecting pending response:", id);
      pending.reject(new Error("Agent stopped"));
    }
    this.pendingResponses.clear();
  }

  send(obj: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) {
      log("send failed: stdin not writable");
      return;
    }
    const json = JSON.stringify(obj);
    log("→ stdin:", json.slice(0, 200));
    this.process.stdin.write(json + "\n");
  }

  sendCommand(obj: Record<string, unknown>): Promise<unknown> {
    const id = `cmd_${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject });
      this.send({ ...obj, id });
    });
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getStderr(): string {
    return this.stderr;
  }

  private setStatus(status: AgentStatus, message?: string): void {
    this.status = status;
    log("status:", status, message || "");
    if (!this.window.isDestroyed()) {
      this.window.webContents.send("agent:status", status, message);
    }
  }

  private handleLine(line: string): void {
    if (this.window.isDestroyed()) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      log("non-JSON stdout:", line.slice(0, 200));
      return;
    }

    const type = data.type as string;
    log("← event:", type, type === "message_update" ? "" : JSON.stringify(data).slice(0, 150));

    if (type === "response" && data.id) {
      const pending = this.pendingResponses.get(data.id as string);
      if (pending) {
        this.pendingResponses.delete(data.id as string);
        if (data.success === false) {
          pending.reject(new Error(data.error as string));
        } else {
          pending.resolve(data.data ?? data);
        }
        return;
      }
    }

    if (type === "extension_ui_request") {
      log("  ui request:", (data as { method?: string }).method, (data as { id?: string }).id);
      this.window.webContents.send("agent:ui-request", data);
      return;
    }

    this.window.webContents.send("agent:event", data);
  }
}
