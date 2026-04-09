import { ChatPanel } from "./chat/chat-panel.js";
import { SidebarPanel } from "./sidebar/sidebar-panel.js";
import { handleExtensionUI } from "./dialogs/extension-dialog.js";
import { showToast } from "./dialogs/extension-dialog.js";

declare global {
  interface Window {
    gxypi: import("../preload/preload.js").GxypiAPI;
  }
}

const gxypi = window.gxypi;

console.log("[gxypi] renderer loaded");
if (!gxypi) {
  console.error("[gxypi] FATAL: window.gxypi is undefined -- preload script may have failed");
}

const chatPanel = new ChatPanel(
  document.getElementById("messages")!,
  document.getElementById("chat-input") as HTMLTextAreaElement,
  document.getElementById("send-btn") as HTMLButtonElement
);

const sidebar = new SidebarPanel(
  document.getElementById("sidebar-content")!
);

// ── Agent events ──────────────────────────────────────────────

let isStreaming = false;

gxypi.onAgentEvent((event) => {
  if (event.type !== "message_update") {
    console.log("[gxypi] event:", event.type);
  }

  switch (event.type) {
    case "agent_start":
      isStreaming = true;
      chatPanel.startAssistantMessage();
      break;

    case "agent_end":
      isStreaming = false;
      chatPanel.finishAssistantMessage();
      break;

    case "message_update": {
      const evt = event.assistantMessageEvent as
        | { type: string; delta?: string }
        | undefined;
      if (!evt) break;

      if (evt.type === "text_delta" && evt.delta) {
        chatPanel.appendDelta(evt.delta);
      }
      break;
    }

    case "tool_execution_start":
      chatPanel.addToolCard(
        event.toolName as string,
        "running"
      );
      break;

    case "tool_execution_end":
      chatPanel.updateToolCard(
        event.toolName as string,
        event.isError ? "error" : "done",
        event.result as string | undefined
      );
      break;

    case "auto_retry_start":
      showToast(
        `Retrying (${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`,
        "warning"
      );
      break;

    case "auto_retry_end":
      if (!event.success) {
        showToast(`Failed after ${event.attempt} retries: ${event.finalError}`, "error");
      }
      break;

    case "extension_error":
      showToast(`Extension error: ${event.message || event.error}`, "error");
      break;
  }
});

// ── Extension UI requests ─────────────────────────────────────

gxypi.onUiRequest((request) => {
  handleExtensionUI(request, chatPanel);
});

// ── Agent status ──────────────────────────────────────────────

const statusDot = document.getElementById("agent-status")!;

const errorBanner = document.createElement("div");
errorBanner.className = "error-banner hidden";
document.getElementById("chat-panel")!.prepend(errorBanner);

function showErrorBanner(message: string): void {
  errorBanner.innerHTML = "";

  const text = document.createElement("span");
  text.textContent = message;

  const restartBtn = document.createElement("button");
  restartBtn.className = "error-restart-btn";
  restartBtn.textContent = "Restart Agent";
  restartBtn.addEventListener("click", () => {
    hideErrorBanner();
    gxypi.restartAgent();
  });

  errorBanner.appendChild(text);
  errorBanner.appendChild(restartBtn);
  errorBanner.classList.remove("hidden");
}

function hideErrorBanner(): void {
  errorBanner.classList.add("hidden");
}

gxypi.onAgentStatus((status, msg) => {
  console.log("[gxypi] status:", status, msg || "");
  statusDot.className = `status-dot ${status}`;
  statusDot.title = msg || status;

  if (status === "error") {
    showErrorBanner(msg || "Agent crashed unexpectedly");
  } else if (status === "running") {
    hideErrorBanner();
  }
});

// ── Chat input ────────────────────────────────────────────────

chatPanel.onSubmit = (text) => {
  chatPanel.addUserMessage(text);

  if (isStreaming) {
    gxypi.steer(text);
  } else {
    gxypi.prompt(text);
  }
};

chatPanel.onAbort = () => {
  gxypi.abort();
};

// ── Sidebar toggle ────────────────────────────────────────────

const sidebarEl = document.getElementById("sidebar")!;
const dividerEl = document.getElementById("divider")!;

gxypi.onToggleSidebar(() => {
  sidebarEl.classList.toggle("hidden");
  dividerEl.style.display = sidebarEl.classList.contains("hidden")
    ? "none"
    : "";
});

// ── Sidebar widget updates via extension UI ───────────────────

gxypi.onUiRequest((request) => {
  if (request.method === "setWidget" && request.widgetKey && request.widgetLines) {
    sidebar.updateWidget(request.widgetKey, request.widgetLines);
  }
  if (request.method === "setStatus" && request.statusKey) {
    sidebar.updateStatus(request.statusKey, request.statusText);
  }
  if (request.method === "setTitle" && request.title) {
    document.title = request.title;
  }
});

// ── Draggable divider ─────────────────────────────────────────

let isDragging = false;

dividerEl.addEventListener("mousedown", (e) => {
  isDragging = true;
  dividerEl.classList.add("dragging");
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const newWidth = document.body.clientWidth - e.clientX;
  const clamped = Math.max(200, Math.min(600, newWidth));
  sidebarEl.style.width = `${clamped}px`;
});

document.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    dividerEl.classList.remove("dragging");
  }
});

// ── Keyboard shortcuts ────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Escape while streaming → abort
  if (e.key === "Escape" && isStreaming) {
    gxypi.abort();
  }
});
