import { ChatPanel } from "./chat/chat-panel.js";
import { ShellPanel } from "./chat/shell-panel.js";
import { ArtifactPanel } from "./artifacts/artifact-panel.js";
import { StepGraph } from "./artifacts/step-graph-react.js";

declare global {
  interface Window {
    orbit: import("../preload/preload.js").OrbitAPI;
  }
}

// ── Components ────────────────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages")!;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn")!;
const abortBtn = document.getElementById("abort-btn")!;
const statusBadge = document.getElementById("agent-status")!;

const cwdPathEl = document.getElementById("cwd-path")!;
const cwdChangeBtn = document.getElementById("cwd-change")!;
const usageTokensEl = document.getElementById("usage-tokens")!;
const usageCostEl = document.getElementById("usage-cost")!;
const modelIndicatorEl = document.getElementById("model-indicator")!;
const modelIndicatorNameEl = document.getElementById("model-indicator-name")!;

const chat = new ChatPanel(messagesEl);
const artifacts = new ArtifactPanel();
const stepGraph = new StepGraph(document.getElementById("tab-steps")!);
const shell = new ShellPanel(document.getElementById("agent-shell-body")!);

let streaming = false;

// ── Usage Tracking ────────────────────────────────────────────────────────────

// Per-1M-token pricing (USD). null = unknown → cost hidden.
// Update as providers change pricing or add models.
const PRICING: Record<string, { in: number; out: number; cacheRead?: number; cacheWrite?: number }> = {
  // Anthropic
  "claude-opus-4-6":      { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-opus-4-5":      { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4-6":    { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5":    { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5":     { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // OpenAI
  "gpt-4o":               { in: 2.5, out: 10, cacheRead: 1.25 },
  "gpt-4o-mini":          { in: 0.15, out: 0.6, cacheRead: 0.075 },
  "gpt-4-turbo":          { in: 10, out: 30 },
  "o1":                   { in: 15, out: 60, cacheRead: 7.5 },
  "o1-mini":              { in: 3, out: 12, cacheRead: 1.5 },
  // Google
  "gemini-2.5-pro":       { in: 1.25, out: 10 },
  "gemini-2.5-flash":     { in: 0.15, out: 0.6 },
  // Ollama (local) — free
  "qwen3-coder:30b":      { in: 0, out: 0 },
  "qwen3:8b":             { in: 0, out: 0 },
};

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const sessionUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const turnUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
let currentModel: string | null = null;

/** Match a model ID against the pricing table (handles date suffixes). */
function findPricing(model: string): { in: number; out: number; cacheRead?: number; cacheWrite?: number } | null {
  // Exact match first
  if (PRICING[model]) return PRICING[model];
  // Strip date suffix (e.g. claude-opus-4-6-20250514)
  const stripped = model.replace(/-\d{8}$/, "");
  if (PRICING[stripped]) return PRICING[stripped];
  // Prefix match
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function computeCost(u: Usage, model: string | null): number | null {
  if (!model) return null;
  const p = findPricing(model);
  if (!p) return null;
  const cost =
    (u.input * p.in) / 1_000_000 +
    (u.output * p.out) / 1_000_000 +
    (u.cacheRead * (p.cacheRead ?? p.in)) / 1_000_000 +
    (u.cacheWrite * (p.cacheWrite ?? p.in)) / 1_000_000;
  return cost;
}

function renderUsage(): void {
  const total = sessionUsage.input + sessionUsage.output + sessionUsage.cacheRead + sessionUsage.cacheWrite;
  usageTokensEl.textContent = `${formatTokens(total)} tok`;
  usageTokensEl.title =
    `Session usage:\n` +
    `  input: ${sessionUsage.input.toLocaleString()}\n` +
    `  output: ${sessionUsage.output.toLocaleString()}\n` +
    `  cache read: ${sessionUsage.cacheRead.toLocaleString()}\n` +
    `  cache write: ${sessionUsage.cacheWrite.toLocaleString()}` +
    (currentModel ? `\nmodel: ${currentModel}` : "");

  const cost = computeCost(sessionUsage, currentModel);
  if (cost !== null) {
    usageCostEl.textContent = cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`;
    usageCostEl.classList.remove("hidden");
  } else {
    usageCostEl.textContent = "";
    usageCostEl.classList.add("hidden");
  }
}

/** Format a long model id into a short display label, e.g. claude-sonnet-4-6 → "Sonnet 4.6". */
function shortModelLabel(model: string): string {
  // Strip date suffix (claude-opus-4-6-20250514 → claude-opus-4-6)
  const id = model.replace(/-\d{8}$/, "");
  // Anthropic
  const cm = id.match(/^claude-(opus|sonnet|haiku)-(\d+(?:-\d+)?)/);
  if (cm) {
    const family = cm[1].charAt(0).toUpperCase() + cm[1].slice(1);
    const ver = cm[2].replace(/-/g, ".");
    return `${family} ${ver}`;
  }
  // OpenAI
  if (id.startsWith("gpt-")) return id.toUpperCase().replace("GPT-", "GPT-");
  if (id === "o1") return "o1";
  if (id === "o1-mini") return "o1 mini";
  // Google
  if (id.startsWith("gemini-")) return id.replace("gemini-", "Gemini ").replace(/-/g, " ");
  // Ollama / local Qwen models — display as "Qwen3-Coder 30B (local)" etc.
  const qm = id.match(/^qwen(\d+)(-coder)?:(\d+\w*)$/);
  if (qm) {
    const family = `Qwen${qm[1]}${qm[2] ? "-Coder" : ""}`;
    return `${family} ${qm[3].toUpperCase()} (local)`;
  }
  // Default: return as-is
  return id;
}

function renderModelIndicator(): void {
  if (currentModel) {
    modelIndicatorNameEl.textContent = shortModelLabel(currentModel);
    modelIndicatorEl.title = `Model: ${currentModel}\nClick to change in Preferences`;
    modelIndicatorEl.classList.remove("hidden");
  } else {
    modelIndicatorEl.classList.add("hidden");
  }
}

modelIndicatorEl.addEventListener("click", () => {
  void openPreferences();
});

// ── Artifact pane collapse/expand ────────────────────────────────────────────

const ARTIFACT_COLLAPSED_KEY = "orbit.artifactCollapsed";
const artifactToggleBtn = document.getElementById("artifact-toggle")!;

function setArtifactCollapsed(collapsed: boolean): void {
  document.body.classList.toggle("artifact-collapsed", collapsed);
  localStorage.setItem(ARTIFACT_COLLAPSED_KEY, collapsed ? "1" : "0");
}

// Default: collapsed (single-pane chat). Auto-reveals on first plan event.
const savedCollapsed = localStorage.getItem(ARTIFACT_COLLAPSED_KEY);
setArtifactCollapsed(savedCollapsed === null ? true : savedCollapsed === "1");

artifactToggleBtn.addEventListener("click", () => {
  setArtifactCollapsed(!document.body.classList.contains("artifact-collapsed"));
});

// Cmd/Ctrl+\ keyboard shortcut
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
    e.preventDefault();
    setArtifactCollapsed(!document.body.classList.contains("artifact-collapsed"));
  }
});

// ── Execution mode toggle (Local / Remote) ───────────────────────────────────

const execModeToggle = document.getElementById("exec-mode-toggle")!;
const execModeButtons = execModeToggle.querySelectorAll<HTMLButtonElement>("button");

function applyExecModeUI(mode: "local" | "remote", galaxyConfigured: boolean): void {
  execModeButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    if (b.dataset.mode === "remote") {
      b.disabled = !galaxyConfigured;
      b.title = galaxyConfigured ? "Remote: agent can use Galaxy" : "Configure Galaxy in Preferences to enable Remote mode";
    } else {
      b.title = "Local: all jobs run locally";
    }
  });
}

async function loadExecModeFromConfig(): Promise<void> {
  const cfg = (await window.orbit.getConfig()) as Record<string, unknown>;
  const mode = (cfg.executionMode as "local" | "remote") || "local";
  const galaxy = cfg.galaxy as { active?: string; profiles?: Record<string, unknown> } | undefined;
  const galaxyConfigured = !!(galaxy?.active && galaxy?.profiles?.[galaxy.active]);
  applyExecModeUI(mode, galaxyConfigured);
}
void loadExecModeFromConfig();

execModeButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const mode = btn.dataset.mode as "local" | "remote";
    if (btn.classList.contains("active")) return;

    // Save mode to config and restart agent
    const cfg = (await window.orbit.getConfig()) as Record<string, unknown>;
    cfg.executionMode = mode;
    await window.orbit.saveConfig(cfg);
    chat.addInfoMessage(`<i>Execution mode → <b>${mode}</b>. Agent restarting…</i>`);
    await loadExecModeFromConfig();
  });
});

// ── First-run welcome screen ─────────────────────────────────────────────────

const welcomeOverlay = document.getElementById("welcome-overlay")!;
const welcomeProvider = document.getElementById("welcome-provider") as HTMLSelectElement;
const welcomeModel = document.getElementById("welcome-model") as HTMLSelectElement;
const welcomeApiKey = document.getElementById("welcome-api-key") as HTMLInputElement;
const welcomeGalaxyUrl = document.getElementById("welcome-galaxy-url") as HTMLInputElement;
const welcomeGalaxyKey = document.getElementById("welcome-galaxy-key") as HTMLInputElement;
const welcomeCwd = document.getElementById("welcome-cwd") as HTMLInputElement;
const welcomeBrowseCwd = document.getElementById("welcome-browse-cwd")!;
const welcomeSave = document.getElementById("welcome-save")!;
const welcomeError = document.getElementById("welcome-error")!;

function populateWelcomeModels(provider: string): void {
  welcomeModel.innerHTML = "";
  const models = MODELS_BY_PROVIDER[provider] || [];
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    welcomeModel.appendChild(opt);
  }
}
welcomeProvider.addEventListener("change", () => populateWelcomeModels(welcomeProvider.value));

welcomeBrowseCwd.addEventListener("click", async () => {
  const dir = await window.orbit.selectDirectory();
  if (dir) welcomeCwd.value = dir;
});

welcomeSave.addEventListener("click", async () => {
  welcomeError.textContent = "";
  const apiKey = welcomeApiKey.value.trim();
  if (!apiKey) {
    welcomeError.textContent = "API key is required";
    return;
  }

  const cfg: Record<string, unknown> = {
    llm: {
      provider: welcomeProvider.value,
      model: welcomeModel.value,
      apiKey,
    },
    executionMode: "local",
  };

  const galaxyUrl = welcomeGalaxyUrl.value.trim();
  const galaxyKey = welcomeGalaxyKey.value.trim();
  if (galaxyUrl && galaxyKey) {
    cfg.galaxy = {
      active: "default",
      profiles: { default: { url: galaxyUrl, apiKey: galaxyKey } },
    };
  }

  const cwd = welcomeCwd.value.trim();
  if (cwd) cfg.defaultCwd = cwd;

  await window.orbit.saveConfig(cfg);
  welcomeOverlay.classList.add("hidden");
  await loadExecModeFromConfig();
});

async function checkFirstRun(): Promise<void> {
  const cfg = (await window.orbit.getConfig()) as { llm?: { apiKey?: string } };
  if (!cfg.llm?.apiKey) {
    populateWelcomeModels(welcomeProvider.value);
    welcomeOverlay.classList.remove("hidden");
  }
}
void checkFirstRun();

function captureUsage(event: Record<string, unknown>): void {
  // message_start carries model info; message updates carry rolling usage
  const msg = event.message as Record<string, unknown> | undefined;
  if (!msg) return;

  if (msg.model && typeof msg.model === "string" && msg.model !== currentModel) {
    currentModel = msg.model;
    renderModelIndicator();
  }

  const u = msg.usage as Partial<Usage> | undefined;
  if (!u) return;

  // turnUsage tracks the in-progress turn's cumulative values
  turnUsage.input = u.input ?? turnUsage.input;
  turnUsage.output = u.output ?? turnUsage.output;
  turnUsage.cacheRead = u.cacheRead ?? turnUsage.cacheRead;
  turnUsage.cacheWrite = u.cacheWrite ?? turnUsage.cacheWrite;
}

function commitTurnUsage(): void {
  sessionUsage.input += turnUsage.input;
  sessionUsage.output += turnUsage.output;
  sessionUsage.cacheRead += turnUsage.cacheRead;
  sessionUsage.cacheWrite += turnUsage.cacheWrite;
  turnUsage.input = 0;
  turnUsage.output = 0;
  turnUsage.cacheRead = 0;
  turnUsage.cacheWrite = 0;
  renderUsage();
}

renderUsage();

// Populate model indicator from config at startup so it shows before the first message
void (async () => {
  try {
    const cfg = await window.orbit.getConfig() as { llm?: { model?: string } };
    if (cfg.llm?.model) {
      currentModel = cfg.llm.model;
      renderModelIndicator();
    }
  } catch { /* getConfig may not be available yet */ }
})();

// ── CWD Display ──────────────────────────────────────────────────────────────

async function refreshCwd(): Promise<void> {
  try {
    const cwd = await window.orbit.getCwd();
    cwdPathEl.textContent = cwd;
    cwdPathEl.title = cwd;
  } catch { /* getCwd not available yet */ }
}

function applyCwdChange(dir: string): void {
  cwdPathEl.textContent = dir;
  cwdPathEl.title = dir;
  window.orbit.prompt(`[system] Analysis directory changed to: ${dir}`);
}

cwdChangeBtn.addEventListener("click", async () => {
  const dir = await window.orbit.selectDirectory();
  if (dir) applyCwdChange(dir);
});

// File > Open Analysis Directory menu triggers this
window.orbit.onCwdChanged((dir) => {
  applyCwdChange(dir);
});

refreshCwd();

// ── Chat Input ────────────────────────────────────────────────────────────────

/** Queued message — stashed when user submits while agent is streaming. */
let pendingMessage: string | null = null;

function updateQueuedIndicator(): void {
  const indicator = document.getElementById("queued-indicator");
  if (!indicator) return;
  if (pendingMessage) {
    indicator.classList.remove("hidden");
    indicator.title = `Queued: ${pendingMessage.slice(0, 100)}${pendingMessage.length > 100 ? "…" : ""} (click to cancel)`;
  } else {
    indicator.classList.add("hidden");
  }
}

/** Clear any queued message without sending it. */
function clearPendingMessage(): void {
  pendingMessage = null;
  updateQueuedIndicator();
}

// Click the indicator to cancel the queued message
document.getElementById("queued-indicator")?.addEventListener("click", () => {
  clearPendingMessage();
});

function submit(): void {
  const text = inputEl.value.trim();
  if (!text) return;

  // Slash commands — handled locally, no LLM round-trip (allowed even while streaming)
  if (text.startsWith("/")) {
    if (handleSlashCommand(text)) {
      inputEl.value = "";
      inputEl.style.height = "auto";
      return;
    }
  }

  // If the agent is mid-turn, queue the message and flush when agent_end fires.
  if (streaming) {
    pendingMessage = text;
    inputEl.value = "";
    inputEl.style.height = "auto";
    updateQueuedIndicator();
    return;
  }

  chat.addUserMessage(text);
  chat.showThinking();
  statusBadge.textContent = "thinking...";
  statusBadge.className = "status-badge thinking";
  window.orbit.prompt(text);
  inputEl.value = "";
  inputEl.style.height = "auto";
}

/** Flush any queued message after the current turn ends. */
function flushPendingMessage(): void {
  if (!pendingMessage) return;
  const text = pendingMessage;
  pendingMessage = null;
  updateQueuedIndicator();
  // Use requestAnimationFrame so the UI updates before we start the next turn
  requestAnimationFrame(() => {
    chat.addUserMessage(text);
    chat.showThinking();
    statusBadge.textContent = "thinking...";
    statusBadge.className = "status-badge thinking";
    window.orbit.prompt(text);
  });
}

/**
 * Handle slash commands. Returns true if handled (no need to send to agent).
 *
 * Supported:
 *   /model <name>   — switch LLM model (e.g. /model sonnet, /model claude-opus-4-6)
 *   /help           — list slash commands
 */
function handleSlashCommand(text: string): boolean {
  const [cmd, ...rest] = text.slice(1).split(/\s+/);

  if (cmd === "model") {
    const arg = rest.join(" ").trim().toLowerCase();
    if (!arg) {
      chat.addUserMessage(text);
      chat.addErrorMessage(
        "Usage: /model <name>. Examples: /model sonnet, /model haiku, /model opus, " +
        "or /model claude-sonnet-4-6 for an exact id."
      );
      return true;
    }
    void switchModelByAlias(text, arg);
    return true;
  }

  if (cmd === "new" || cmd === "reset" || cmd === "clear") {
    void confirmAndResetSession();
    return true;
  }

  // pi-galaxy-analyst commands — pass through to agent
  if (cmd === "plan" || cmd === "status" || cmd === "notebook" || cmd === "decisions" || cmd === "profiles") {
    chat.addUserMessage(text);
    window.orbit.prompt(`/${cmd}`);
    return true;
  }

  if (cmd === "connect") {
    void openPreferences();
    return true;
  }

  if (cmd === "review") {
    runReviewParams();
    return true;
  }

  if (cmd === "test") {
    runTestExecution();
    return true;
  }

  if (cmd === "execute" || cmd === "run") {
    runRealExecution();
    return true;
  }

  if (cmd === "help") {
    chat.addUserMessage(text);
    chat.addInfoMessage(
      `<h3>Slash commands</h3>` +
      `<ul>` +
      `<li><code>/model &lt;name&gt;</code> — switch LLM model</li>` +
      `<li><code>/new</code> — start a fresh session</li>` +
      `<li><code>/review</code> — review plan parameters before execution</li>` +
      `<li><code>/test</code> — run the plan on minimal/test data</li>` +
      `<li><code>/execute</code> (alias <code>/run</code>) — execute the plan on real data</li>` +
      `<li><code>/plan</code> — show current plan summary</li>` +
      `<li><code>/status</code> — show Galaxy connection status</li>` +
      `<li><code>/notebook</code> — show notebook info</li>` +
      `<li><code>/decisions</code> — show decision log</li>` +
      `<li><code>/connect</code> — open Galaxy connection settings</li>` +
      `<li><code>/help</code> — show this help</li>` +
      `</ul>`
    );
    return true;
  }

  return false; // not a recognized slash command — let it through
}

/** Ask for confirmation, then wipe both panes + restart agent. */
async function confirmAndResetSession(): Promise<void> {
  const ok = confirm("Start a fresh session? This will erase your current chat, plan, steps, and results.");
  if (!ok) return;
  await resetSession();
}

/** Wipe chat + artifacts + restart the agent without --continue (fresh Pi.dev session). */
async function showCwdWelcome(): Promise<void> {
  let cwd = "~";
  try {
    cwd = await window.orbit.getCwd();
  } catch { /* getCwd unavailable */ }
  chat.addInfoMessage(
    `<b>Current working directory:</b> <code>${cwd.replace(/</g, "&lt;")}</code><br>` +
    `For a new project you may want to <a href="#" id="switch-dir-link">switch to a new directory</a> to keep everything clean.`
  );
  // Wire the link to the existing cwd-change button handler
  document.getElementById("switch-dir-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    (document.getElementById("cwd-change") as HTMLButtonElement | null)?.click();
  });
}

async function resetSession(): Promise<void> {
  chat.clear();
  artifacts.clear();
  clearPendingMessage();
  // Reset usage counters
  sessionUsage.input = 0;
  sessionUsage.output = 0;
  sessionUsage.cacheRead = 0;
  sessionUsage.cacheWrite = 0;
  turnUsage.input = 0;
  turnUsage.output = 0;
  turnUsage.cacheRead = 0;
  turnUsage.cacheWrite = 0;
  renderUsage();

  await window.orbit.resetSession();

  // Fresh session has no greeting turn, so agent_end never fires.
  // Clear streaming state explicitly so the input is usable immediately.
  streaming = false;
  hasShownPlanOnce = false;
  sendBtn.classList.remove("hidden");
  abortBtn.classList.add("hidden");
  statusBadge.textContent = "Ready";
  statusBadge.className = "status-badge";

  chat.addInfoMessage("<i>Started fresh session.</i>");

  // Open artifact pane on Notebook tab so the fresh session starts visible.
  setArtifactCollapsed(false);
  switchTab("results");

  // Reset startup-welcome flag so the onAgentStatus handler re-runs
  // the cwd welcome when the new agent reports "running".
  hasShownStartupWelcome = false;

  await showCwdWelcome();
}

/** Resolve a model alias across ALL providers and switch + restart agent. */
async function switchModelByAlias(originalText: string, alias: string): Promise<void> {
  chat.addUserMessage(originalText);

  const cfg = await window.orbit.getConfig() as { llm?: { provider?: string } };
  const currentProvider = cfg.llm?.provider || "anthropic";

  // Search strategy: prefer current provider, then search all providers.
  // Within each provider: exact id match → id substring → label substring.
  let chosen: { provider: string; model: ModelChoice } | undefined;

  const search = (p: string): ModelChoice | undefined => {
    const cat = MODELS_BY_PROVIDER[p] || [];
    return (
      cat.find(m => m.id === alias) ||
      cat.find(m => m.id.toLowerCase().includes(alias)) ||
      cat.find(m => m.label.toLowerCase().includes(alias))
    );
  };

  // 1. Try current provider first (preserves user's existing setup)
  const inCurrent = search(currentProvider);
  if (inCurrent) {
    chosen = { provider: currentProvider, model: inCurrent };
  } else {
    // 2. Fall back to searching every provider
    for (const p of Object.keys(MODELS_BY_PROVIDER)) {
      if (p === currentProvider) continue;
      const m = search(p);
      if (m) { chosen = { provider: p, model: m }; break; }
    }
  }

  if (!chosen) {
    const all = Object.entries(MODELS_BY_PROVIDER)
      .map(([p, models]) => `  ${p}: ${models.map(m => m.id).join(", ")}`)
      .join("\n");
    chat.addErrorMessage(
      `No model matches "${alias}". Available models:\n${all}`
    );
    return;
  }

  // Save updated config
  const current = await window.orbit.getConfig() as Record<string, unknown>;
  const llm = ((current.llm as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;

  const switchingProvider = chosen.provider !== currentProvider;
  if (switchingProvider) {
    llm.provider = chosen.provider;
    // Don't clobber the existing API key — if the user has none for the new provider,
    // the agent restart will fail with a clear error and they can set it in Preferences.
  }
  llm.model = chosen.model.id;
  current.llm = llm;

  const result = await window.orbit.saveConfig(current);
  if (!result.success) {
    chat.addErrorMessage(`Failed to save config: ${result.error}`);
    return;
  }

  if (switchingProvider) {
    chat.addErrorMessage(
      `Switched to ${chosen.provider} / ${chosen.model.id}. Agent restarting… ` +
      `(if you don't have a ${chosen.provider} API key set in Preferences, the agent will fail to start)`
    );
  } else {
    chat.addErrorMessage(`Model switched to ${chosen.model.id}. Agent restarting…`);
  }
}

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
});

sendBtn.addEventListener("click", submit);

abortBtn.addEventListener("click", () => {
  window.orbit.abort();
  clearPendingMessage();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && streaming) {
    window.orbit.abort();
    clearPendingMessage();
  }
});

// ── Agent Events ──────────────────────────────────────────────────────────────

window.orbit.onAgentEvent((event) => {
  const type = event.type as string;
  console.log("[orbit] event:", type, JSON.stringify(event).slice(0, 150));

  // Capture usage from any event that carries a message with usage
  if (type === "message_start" || type === "message_update" || type === "message_end" || type === "turn_end") {
    captureUsage(event as Record<string, unknown>);
  }

  // Feed the agent shell with interesting events
  feedShell(event);

  switch (type) {
    case "agent_start":
      streaming = true;
      sendBtn.classList.add("hidden");
      abortBtn.classList.remove("hidden");
      // Don't hide thinking yet — wait for actual text content
      break;

    case "message_update": {
      // Pi.dev wraps events in assistantMessageEvent
      const ame = (event as { assistantMessageEvent?: Record<string, unknown> }).assistantMessageEvent;
      if (!ame) break;

      const ameType = ame.type as string;

      if (ameType === "text_start") {
        chat.hideThinking();
        statusBadge.textContent = "responding...";
        statusBadge.className = "status-badge running";
        if (!streaming) {
          streaming = true;
          sendBtn.classList.add("hidden");
          abortBtn.classList.remove("hidden");
        }
        // Only start a new message if there isn't one active
        if (!chat.hasActiveMessage()) {
          chat.startAssistantMessage();
        }
      } else if (ameType === "text_delta") {
        chat.hideThinking();
        if (!streaming) {
          streaming = true;
          sendBtn.classList.add("hidden");
          abortBtn.classList.remove("hidden");
        }
        if (!chat.hasActiveMessage()) {
          chat.startAssistantMessage();
        }
        const delta = ame.delta as string;
        if (delta) chat.appendDelta(delta);
      } else if (ameType === "text_end") {
        // text block finished, but agent turn might continue
      }
      break;
    }

    case "message_end": {
      // Commit per-assistant-message usage to the session total
      // Each assistant message = one LLM call billed separately
      const msg = (event as { message?: { role?: string } }).message;
      if (msg?.role === "assistant") {
        commitTurnUsage();
      }
      break;
    }

    case "turn_end":
      // Turn might not be fully done until agent_end
      break;

    case "tool_start": {
      chat.hideThinking();
      const name = (event as { tool?: string }).tool || "tool";
      const id = (event as { id?: string }).id || name;
      chat.addToolCard(id, name);
      statusBadge.textContent = `running: ${name}`;
      statusBadge.className = "status-badge running";
      break;
    }

    case "tool_end": {
      const id = (event as { id?: string }).id || "";
      const result = (event as { result?: string }).result;
      const error = (event as { error?: string }).error;
      chat.updateToolCard(id, error ? "error" : "done", result || error);
      break;
    }

    case "agent_end":
      chat.hideThinking();
      streaming = false;
      statusBadge.textContent = "Ready";
      statusBadge.className = "status-badge";
      sendBtn.classList.remove("hidden");
      abortBtn.classList.add("hidden");
      chat.finishAssistantMessage();
      // Safety: clear any stuck button busy states if the turn ends without the
      // expected completion event arriving
      flushPendingMessage();
      break;

    case "error": {
      const msg = (event as { message?: string }).message || "Unknown error";
      chat.hideThinking();
      chat.addErrorMessage(msg);
      streaming = false;
      statusBadge.textContent = "error";
      statusBadge.className = "status-badge error";
      sendBtn.classList.remove("hidden");
      abortBtn.classList.add("hidden");
      // Clear any queued message on error so the indicator doesn't get stuck
      clearPendingMessage();
      break;
    }
  }
});

// ── UI Requests (from extension via Pi.dev) ──────────────────────────────────

window.orbit.onUiRequest((request) => {
  console.log("[orbit] UI request:", request.method, (request as Record<string, unknown>).widgetKey || "");
  const method = request.method;

  if (method === "notify") {
    const message = (request as Record<string, unknown>).message as string | undefined;
    const notifyType = (request as Record<string, unknown>).notifyType as string | undefined;
    if (message) {
      const prefix = notifyType === "warning" ? "⚠️ " : notifyType === "error" ? "❌ " : "";
      chat.addInfoMessage(prefix + message.replace(/</g, "&lt;"));
    }
    return;
  }

  if (method === "setWidget") {
    const key = request.widgetKey as string;
    const lines = request.widgetLines as string[] | undefined;

    if (key === "plan" && lines) {
      console.log("[orbit] plan widget received, lines:", lines.length);
      artifacts.setPlanText(lines.join("\n"));
      // First plan: auto-reveal artifact pane and switch to Plan tab.
      if (!hasShownPlanOnce) {
        setArtifactCollapsed(false);
        switchTab("plan");
        hasShownPlanOnce = true;
      } else {
        markTabNew("plan");
      }
    }

    if (key === "steps" && lines) {
      console.log("[orbit] steps widget received, count:", lines[0]?.length);
      try {
        const steps = JSON.parse(lines[0]);
        console.log("[orbit] parsed steps:", steps.length);
        stepGraph.render(steps);
        markTabNew("steps");
      } catch (e) { console.error("[orbit] steps parse error:", e); }
    }

    if (key === "results" && lines) {
      try {
        const block = JSON.parse(lines[0]);
        artifacts.addResultBlock(block);
        markTabNew("results");
      } catch { /* ignore parse errors */ }
    }

    // Legacy alias: /plan slash command emits "plan-view" — route to Plan tab.
    if (key === "plan-view" && lines) {
      artifacts.setPlanText(lines.join("\n"));
      if (!hasShownPlanOnce) { switchTab("plan"); hasShownPlanOnce = true; }
      else { markTabNew("plan"); }
    }

    // /notebook dumps the live notebook.md content — route to Notebook tab.
    if (key === "notebook" && lines) {
      artifacts.setNotebookMarkdown(lines.join("\n"));
      setArtifactCollapsed(false);
      switchTab("results");
    }

    // Phase 4: parameter form — replaces plan view
    if (key === "parameters" && lines) {
      console.log("[orbit] parameters widget received, lines[0] length:", lines[0]?.length);
      try {
        const spec = JSON.parse(lines[0]);
        console.log("[orbit] parsed spec:", spec.title, spec.groups?.length, "groups");
        artifacts.showParameters(spec);
        switchTab("plan");
          shell.append(`  ✓ Parameter form ready (${spec.groups?.length ?? 0} groups)`, "tool-end");
        console.log("[orbit] showParameters complete");
      } catch (err) {
        console.error("[orbit] parameters parse/render error:", err);
        }
    }
  }
});

function switchTab(name: string): void {
  tabs.forEach((t) => t.classList.remove("active"));
  panels.forEach((p) => p.classList.remove("active"));
  document.querySelector(`[data-tab="${name}"]`)?.classList.add("active");
  document.getElementById(`tab-${name}`)?.classList.add("active");
  clearTabNew(name);
}

// ── Agent Status ──────────────────────────────────────────────────────────────

let hasShownStartupWelcome = false;
window.orbit.onAgentStatus((status, msg) => {
  statusBadge.textContent = msg || status;
  statusBadge.className = "status-badge " + status;

  // Show cwd welcome once, after the first successful agent start.
  // Also open the artifact pane on the Notebook tab so the user sees it.
  if (status === "running" && !hasShownStartupWelcome) {
    hasShownStartupWelcome = true;
    setArtifactCollapsed(false);
    switchTab("results");
    void showCwdWelcome();
  }
});

// ── Draggable Divider ─────────────────────────────────────────────────────────

const divider = document.getElementById("divider")!;
const chatPane = document.getElementById("chat-pane")!;

let dragging = false;

divider.addEventListener("mousedown", (e) => {
  e.preventDefault();
  dragging = true;
  divider.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const appWidth = document.getElementById("app")!.clientWidth;
  const pct = (e.clientX / appWidth) * 100;
  const clamped = Math.max(25, Math.min(75, pct));
  chatPane.style.flex = `0 0 ${clamped}%`;
});

document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  divider.classList.remove("dragging");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// ── Artifact Tabs ─────────────────────────────────────────────────────────────

const tabs = document.querySelectorAll<HTMLButtonElement>("#artifact-tabs .tab");
const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

let hasShownPlanOnce = false;

/** Add a "new content" indicator to a tab if it's not currently active. */
function markTabNew(name: string): void {
  const tab = document.querySelector<HTMLElement>(`[data-tab="${name}"]`);
  if (!tab || tab.classList.contains("active")) return;
  tab.classList.add("has-new");
}

/** Clear the new-content indicator on a tab (called when user clicks it). */
function clearTabNew(name: string): void {
  const tab = document.querySelector<HTMLElement>(`[data-tab="${name}"]`);
  tab?.classList.remove("has-new");
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => t.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${target}`)?.classList.add("active");
    if (target) clearTabNew(target);
  });
});

// ── Plan Actions (slash commands) ────────────────────────────────────────────

/** No-op helpers kept so existing call sites for clearButtonBusy don't break. */
function clearButtonBusy(_btn: HTMLButtonElement): void { /* no-op */ }

const paramsBackBtn = document.getElementById("params-back-btn")!;
paramsBackBtn.addEventListener("click", () => {
  artifacts.hideParameters();
});

const paramsSaveBtn = document.getElementById("params-save-btn")!;
paramsSaveBtn.addEventListener("click", () => {
  artifacts.saveParameters();
  artifacts.hideParameters();
  chat.addInfoMessage("Parameters saved.");
});

function runReviewParams(): void {
  const text = artifacts.getPlanText();
  if (!text) {
    chat.addErrorMessage("No plan to review yet.");
    return;
  }
  chat.addUserMessage("/review");
  chat.showThinking();
  statusBadge.textContent = "analyzing parameters…";
  statusBadge.className = "status-badge thinking";
  shell.append("▸ Analyzing plan for critical parameters…", "info");
  window.orbit.prompt(
    `The user typed /review. Analyze every tool in the current plan, ` +
    `identify the CRITICAL biological parameters (hide thread counts, paths, flags, verbose), ` +
    `and call analyze_plan_parameters with a consolidated form spec grouped by biology concept ` +
    `(not by tool). Include biologist-friendly help text for every parameter. ` +
    `Use defaults appropriate for the organism/analysis type. ` +
    `Plan:\n${text}`
  );
}

function runTestExecution(): void {
  const text = artifacts.getPlanText();
  if (!text) {
    chat.addErrorMessage("No plan to test yet.");
    return;
  }
  const saved = artifacts.getSavedParameters() || {};
  artifacts.clearResults();
  chat.addUserMessage("/test");
  artifacts.setParametersDisabled(true);
  window.orbit.prompt(
    `The user typed /test. Configured parameters:\n` +
    `${JSON.stringify(saved, null, 2)}\n\n` +
    `Sequence of calls (in order):\n` +
    `1. reset_plan_steps  — clear stale state\n` +
    `2. generate_test_data  — subsample real files if they exist, otherwise synthesize\n` +
    `3. For each step: update_step(in_progress, with description reflecting test mode) → ` +
    `run_command → update_step(completed, with result) → report_result\n\n` +
    `In test mode, update each step's description to reflect the smaller scope ` +
    `(e.g., 'Downloading 1 test sample' not '270 samples'). ` +
    `Tag results as 'TEST RUN' in the markdown. ` +
    `Do NOT call clear_test_mode — leave test mode on so the user can review. ` +
    `NO chat narration — let the DAG and Notebook tab show progress.\n\nPlan:\n${text}`
  );
}

function runRealExecution(): void {
  const text = artifacts.getPlanText();
  if (!text) {
    chat.addErrorMessage("No plan to execute yet.");
    return;
  }
  const saved = artifacts.getSavedParameters() || {};
  artifacts.clearResults();
  chat.addUserMessage("/execute");
  artifacts.setParametersDisabled(true);
  window.orbit.prompt(
    `The user typed /execute. Configured parameters:\n` +
    `${JSON.stringify(saved, null, 2)}\n\n` +
    `Sequence of calls (in order):\n` +
    `1. If test mode is active, clear_test_mode  — restore real paths\n` +
    `2. reset_plan_steps  — clear stale state from any previous run\n` +
    `3. For each step: update_step(in_progress) → run_command → update_step(completed)\n\n` +
    `NO chat narration — let the DAG and Notebook tab show progress.\n\nPlan:\n${text}`
  );
}

// ── Preferences ──────────────────────────────────────────────────────────────

const prefsOverlay = document.getElementById("prefs-overlay")!;
const prefsClose = document.getElementById("prefs-close")!;
const prefsCancel = document.getElementById("prefs-cancel")!;
const prefsSave = document.getElementById("prefs-save")!;
const prefsBrowseCwd = document.getElementById("prefs-browse-cwd")!;

const prefsProvider = document.getElementById("prefs-provider") as HTMLSelectElement;
const prefsModel = document.getElementById("prefs-model") as HTMLSelectElement;
const prefsApiKey = document.getElementById("prefs-api-key") as HTMLInputElement;

// Model catalog by provider — labels include cost guidance
// (in/out price per 1M tokens). Update when providers add/change models.
interface ModelChoice { id: string; label: string; }
const MODELS_BY_PROVIDER: Record<string, ModelChoice[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — $3/$15 (recommended)" },
    { id: "claude-haiku-4-5",  label: "Haiku 4.5 — $1/$5 (cheapest)" },
    { id: "claude-opus-4-6",   label: "Opus 4.6 — $15/$75 (most capable, expensive)" },
    { id: "claude-sonnet-4-5", label: "Sonnet 4.5 — $3/$15" },
    { id: "claude-opus-4-5",   label: "Opus 4.5 — $15/$75" },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini — $0.15/$0.60 (cheapest)" },
    { id: "gpt-4o",      label: "GPT-4o — $2.50/$10" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo — $10/$30" },
    { id: "o1-mini",     label: "o1-mini — $3/$12" },
    { id: "o1",          label: "o1 — $15/$60" },
  ],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash — $0.15/$0.60 (cheapest)" },
    { id: "gemini-2.5-pro",   label: "Gemini 2.5 Pro — $1.25/$10" },
  ],
  mistral: [
    { id: "mistral-large-latest", label: "Mistral Large" },
    { id: "mistral-medium-latest", label: "Mistral Medium" },
    { id: "mistral-small-latest", label: "Mistral Small" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant",    label: "Llama 3.1 8B (fast)" },
  ],
  xai: [
    { id: "grok-2-latest", label: "Grok 2" },
  ],
  ollama: [
    { id: "qwen3-coder:30b", label: "Qwen3-Coder 30B (local, A5000) — free" },
    { id: "qwen3:8b",        label: "Qwen3 8B (local, fast) — free" },
  ],
};

function populateModels(provider: string, selected?: string): void {
  prefsModel.innerHTML = "";
  const models = MODELS_BY_PROVIDER[provider] || [];
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    if (selected && m.id === selected) opt.selected = true;
    prefsModel.appendChild(opt);
  }
  // If saved model isn't in the catalog (custom or older), add it as a free-form entry
  if (selected && !models.find(m => m.id === selected)) {
    const opt = document.createElement("option");
    opt.value = selected;
    opt.textContent = `${selected} (custom)`;
    opt.selected = true;
    prefsModel.appendChild(opt);
  }
}

// Repopulate model dropdown when provider changes
prefsProvider.addEventListener("change", () => {
  populateModels(prefsProvider.value);
});
const prefsGalaxyUrl = document.getElementById("prefs-galaxy-url") as HTMLInputElement;
const prefsGalaxyKey = document.getElementById("prefs-galaxy-key") as HTMLInputElement;
const prefsDefaultCwd = document.getElementById("prefs-default-cwd") as HTMLInputElement;
const prefsCondaBin = document.getElementById("prefs-conda-bin") as HTMLSelectElement;

async function openPreferences(): Promise<void> {
  const config = await window.orbit.getConfig() as {
    llm?: { provider?: string; apiKey?: string; model?: string };
    galaxy?: { active: string | null; profiles: Record<string, { url: string; apiKey: string }> };
    defaultCwd?: string;
    condaBin?: string;
  };

  prefsProvider.value = config.llm?.provider || "anthropic";
  populateModels(prefsProvider.value, config.llm?.model);
  prefsApiKey.value = config.llm?.apiKey || "";

  // Galaxy: use active profile
  const activeProfile = config.galaxy?.active
    ? config.galaxy.profiles?.[config.galaxy.active]
    : null;
  prefsGalaxyUrl.value = activeProfile?.url || "";
  prefsGalaxyKey.value = activeProfile?.apiKey || "";

  prefsDefaultCwd.value = config.defaultCwd || "";
  prefsCondaBin.value = config.condaBin || "auto";

  prefsOverlay.classList.remove("hidden");
}

function closePreferences(): void {
  prefsOverlay.classList.add("hidden");
}

async function savePreferences(): Promise<void> {
  // Preserve existing config (galaxy profiles) and merge
  const current = await window.orbit.getConfig() as {
    llm?: { provider?: string; apiKey?: string; model?: string };
    galaxy?: { active: string | null; profiles: Record<string, { url: string; apiKey: string }> };
    defaultCwd?: string;
    condaBin?: string;
  };

  const config: typeof current = { ...current };

  config.llm = {
    provider: prefsProvider.value,
    model: prefsModel.value || undefined,
    apiKey: prefsApiKey.value.trim() || undefined,
  };

  // Galaxy: save as "default" profile
  if (prefsGalaxyUrl.value.trim() || prefsGalaxyKey.value.trim()) {
    config.galaxy = {
      active: "default",
      profiles: {
        ...(current.galaxy?.profiles || {}),
        default: {
          url: prefsGalaxyUrl.value.trim(),
          apiKey: prefsGalaxyKey.value.trim(),
        },
      },
    };
  } else {
    delete config.galaxy;
  }

  config.defaultCwd = prefsDefaultCwd.value.trim() || undefined;
  config.condaBin = (prefsCondaBin.value as "auto" | "mamba" | "conda") || undefined;

  const result = await window.orbit.saveConfig(config as Record<string, unknown>);
  if (result.success) {
    closePreferences();
    chat.addUserMessage("[system] Preferences saved. Agent restarted.");
  } else {
    alert(`Failed to save preferences: ${result.error}`);
  }
}

prefsClose.addEventListener("click", closePreferences);
prefsCancel.addEventListener("click", closePreferences);
prefsSave.addEventListener("click", savePreferences);
prefsOverlay.addEventListener("click", (e) => {
  if (e.target === prefsOverlay) closePreferences();
});

prefsBrowseCwd.addEventListener("click", async () => {
  const dir = await window.orbit.browseDirectory();
  if (dir) prefsDefaultCwd.value = dir;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !prefsOverlay.classList.contains("hidden")) {
    closePreferences();
  }
});

window.orbit.onOpenPreferences(() => {
  openPreferences();
});

// ── Agent shell event feed ────────────────────────────────────────────────────

/** Extract a short, useful summary from an agent event and append to the shell. */
function feedShell(event: Record<string, unknown>): void {
  const type = event.type as string;

  switch (type) {
    case "agent_start": {
      shell.append("─── agent turn start ───", "info");
      break;
    }
    case "turn_start": {
      // Some models do multiple "turns" per agent run (thinking, then tools, then text)
      // Skip these to reduce noise; we already have agent_start
      break;
    }
    case "message_start": {
      const msg = event.message as { role?: string; model?: string } | undefined;
      if (msg?.role === "assistant" && msg.model) {
        shell.append(`  thinking… (${msg.model})`, "info");
      }
      break;
    }
    case "message_update": {
      // Show when the agent starts producing visible text / a tool call
      const ame = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (!ame) break;
      if (ame.type === "text_start") {
        shell.append("  ▸ writing response…", "info");
      } else if (ame.type === "toolcall_start") {
        shell.append("  ▸ preparing tool call…", "info");
      }
      break;
    }
    case "tool_execution_start": {
      const name = (event.toolName as string) || "tool";
      const args = event.args as Record<string, unknown> | undefined;
      shell.append(`▸ ${name}(${summarizeArgs(args)})`, "tool-start");
      break;
    }
    case "tool_execution_end": {
      const name = (event.toolName as string) || "tool";
      const result = event.result as { content?: { type: string; text: string }[] } | undefined;
      const text = result?.content?.[0]?.text;
      if (!text) {
        shell.append(`  ✓ ${name} done`, "tool-end");
        break;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed.success === false || parsed.exitCode > 0) {
          const msg = parsed.error || parsed.stderr || parsed.message || "failed";
          shell.append(`  ✗ ${name}: ${truncate(msg, 200)}`, "tool-error");
          // Show a few lines of stderr if present
          if (parsed.stderr && typeof parsed.stderr === "string") {
            for (const line of parsed.stderr.split("\n").slice(-5)) {
              if (line.trim()) shell.append(line, "stdout");
            }
          }
        } else {
          const msg = parsed.message || `exit ${parsed.exitCode ?? 0}`;
          shell.append(`  ✓ ${name}: ${truncate(msg, 200)}`, "tool-end");
          // For run_command, show last few stdout lines
          if (parsed.stdout && typeof parsed.stdout === "string") {
            const lines = parsed.stdout.trim().split("\n").slice(-3);
            for (const line of lines) {
              if (line.trim()) shell.append(line, "stdout");
            }
          }
        }
      } catch {
        // Not JSON — show first 200 chars
        shell.append(`  ✓ ${name}: ${truncate(text, 200)}`, "tool-end");
      }
      break;
    }
    case "extension_ui_request": {
      const method = event.method as string;
      if (method === "setStatus") {
        const key = event.statusKey as string;
        const text = event.statusText as string;
        // Strip ANSI color codes
        const clean = text?.replace(/\x1b\[[0-9;]*m/g, "");
        if (key && key !== "ready" && clean) {
          shell.append(`[${key}] ${clean}`, "status");
        }
      }
      break;
    }
    case "error": {
      const msg = (event.message as string) || "Unknown error";
      shell.append(`✗ ${msg}`, "tool-error");
      break;
    }
  }
}

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  // Format args as compact "key=value" pairs, truncating long strings
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    let s: string;
    if (Array.isArray(v)) {
      s = v.length <= 3 ? `[${v.join(", ")}]` : `[${v.length} items]`;
    } else if (typeof v === "string") {
      s = `"${truncate(v, 60)}"`;
    } else if (v === null || v === undefined) {
      s = String(v);
    } else if (typeof v === "object") {
      s = "{...}";
    } else {
      s = String(v);
    }
    parts.push(`${k}=${s}`);
  }
  return truncate(parts.join(", "), 160);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ── Agent shell toggle ────────────────────────────────────────────────────────

const shellEl = document.getElementById("agent-shell")!;
const shellToggleBtn = document.getElementById("agent-shell-toggle")!;
const shellCloseBtn = document.getElementById("agent-shell-close")!;
const shellClearBtn = document.getElementById("agent-shell-clear")!;

function toggleShell(show?: boolean): void {
  const willShow = show ?? shellEl.classList.contains("hidden");
  shellEl.classList.toggle("hidden", !willShow);
  shellToggleBtn.classList.toggle("active", willShow);
  shellToggleBtn.textContent = willShow ? "▾ shell" : "▸ shell";
}

shellToggleBtn.addEventListener("click", () => toggleShell());
shellCloseBtn.addEventListener("click", () => toggleShell(false));
shellClearBtn.addEventListener("click", () => shell.clear());

// ── Process monitor ──────────────────────────────────────────────────────────

interface ProcInfo {
  pid: number;
  ppid: number;
  pcpu: number;
  pmem: number;
  rss: number;
  etime: string;
  nlwp: number;
  command: string;
}

const procMonitorEl = document.getElementById("proc-monitor")!;
const procMonitorToggleBtn = document.getElementById("proc-monitor-toggle")!;
const procMonitorCloseBtn = document.getElementById("proc-monitor-close")!;
const procMonitorCountEl = document.getElementById("proc-monitor-count")!;
const procMonitorRowsEl = document.getElementById("proc-monitor-rows")!;

function toggleProcMonitor(show?: boolean): void {
  const willShow = show ?? procMonitorEl.classList.contains("hidden");
  procMonitorEl.classList.toggle("hidden", !willShow);
  procMonitorToggleBtn.classList.toggle("active", willShow);
  procMonitorToggleBtn.textContent = willShow ? "▾ procs" : "▸ procs";
}

procMonitorToggleBtn.addEventListener("click", () => toggleProcMonitor());
procMonitorCloseBtn.addEventListener("click", () => toggleProcMonitor(false));

function formatRss(kb: number): string {
  if (kb < 1024) return `${kb}K`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${(kb / (1024 * 1024)).toFixed(1)}G`;
}

function renderProcs(procs: ProcInfo[]): void {
  procMonitorCountEl.textContent = String(procs.length);

  // Auto-show the panel when a process appears, if it was hidden at zero
  if (procs.length > 0 && procMonitorEl.classList.contains("hidden") && !procMonitorUserHidden) {
    toggleProcMonitor(true);
  }

  if (procs.length === 0) {
    procMonitorRowsEl.innerHTML = '<tr><td colspan="6" class="empty-procs">No subprocesses running</td></tr>';
    return;
  }

  // Sort by CPU descending
  const sorted = [...procs].sort((a, b) => b.pcpu - a.pcpu);
  procMonitorRowsEl.innerHTML = sorted.map((p) => `
    <tr>
      <td class="col-num">${p.pid}</td>
      <td class="col-num">${p.pcpu.toFixed(1)}</td>
      <td class="col-num">${p.pmem.toFixed(1)}</td>
      <td class="col-num">${formatRss(p.rss)}</td>
      <td class="col-num">${p.etime}</td>
      <td class="col-cmd" title="${escapeAttr(p.command)}">${escapeHtml(p.command)}</td>
    </tr>
  `).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Remember if user explicitly closed the panel so we don't keep re-opening it
let procMonitorUserHidden = false;
procMonitorCloseBtn.addEventListener("click", () => { procMonitorUserHidden = true; });
procMonitorToggleBtn.addEventListener("click", () => { procMonitorUserHidden = procMonitorEl.classList.contains("hidden"); });

window.orbit.onProcUpdate((procs) => {
  renderProcs(procs as ProcInfo[]);
});

// ── Focus input on load ───────────────────────────────────────────────────────
inputEl.focus();
