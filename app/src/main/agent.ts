import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import type { BrowserWindow } from "electron";

// Resolve the gxypi entry point relative to the app
const GXYPI_BIN = path.resolve(__dirname, "../../../bin/gxypi.js");

export type AgentStatus = "running" | "stopped" | "error";

interface PendingResponse {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

export class AgentManager {
  private process: ChildProcess | null = null;
  private window: BrowserWindow;
  private status: AgentStatus = "stopped";
  private stderr = "";
  private pendingResponses = new Map<string, PendingResponse>();
  private idCounter = 0;

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  start(): void {
    if (this.process) this.stop();

    this.stderr = "";
    this.setStatus("running");

    this.process = spawn("node", [GXYPI_BIN, "--mode", "rpc"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env },
    });

    const rl = createInterface({
      input: this.process.stdout!,
      terminal: false,
    });

    rl.on("line", (line) => this.handleLine(line));

    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });

    this.process.on("exit", (code) => {
      this.process = null;
      if (code !== 0 && code !== null) {
        this.setStatus("error", `Agent exited with code ${code}`);
      } else {
        this.setStatus("stopped");
      }
    });

    this.process.on("error", (err) => {
      this.process = null;
      this.setStatus("error", err.message);
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.setStatus("stopped");
    // Reject all pending responses
    for (const [, pending] of this.pendingResponses) {
      pending.reject(new Error("Agent stopped"));
    }
    this.pendingResponses.clear();
  }

  send(obj: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(JSON.stringify(obj) + "\n");
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
      return;
    }

    // Route responses to pending promises
    if (data.type === "response" && data.id) {
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

    // Route extension UI requests
    if (data.type === "extension_ui_request") {
      this.window.webContents.send("agent:ui-request", data);
      return;
    }

    // Everything else is an agent event
    this.window.webContents.send("agent:event", data);
  }
}
