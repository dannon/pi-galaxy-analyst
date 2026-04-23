/**
 * ArtifactPanel renders the right-hand pane with two tabs: Notebook and Activity.
 *
 * - Notebook tab: renders the live notebook.md markdown emitted by the brain.
 * - Activity tab: renders a timeline of activity.jsonl events emitted by the brain.
 */

import { Marked } from "marked";
import type { ShellActivityEvent } from "../../../../shared/loom-shell-contract.js";

// Dedicated Marked instance for the notebook pane. Relative image srcs (e.g.
// `10_figures/foo.png`) are rewritten to the `orbit-artifact://` scheme served
// by the main process out of the current analysis cwd. Chat messages keep the
// default `marked` so agent-authored URLs aren't touched.
const notebookMarked = new Marked({
  renderer: {
    image({ href, title, text }) {
      const rewritten = rewriteArtifactHref(href);
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(rewritten)}" alt="${escapeAttr(text)}"${titleAttr}>`;
    },
  },
});

function rewriteArtifactHref(href: string): string {
  // Leave absolute URLs and protocol-relative URLs alone.
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return href;
  return `orbit-artifact://cwd/${href.replace(/^\/+/, "")}`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const NOTEBOOK_EMPTY_HTML = `
  <div class="empty-state">
    <p>The notebook is the running log of your analysis — plan, steps, decisions, and Galaxy references — persisted to a markdown file in your working directory and committed to git on every change.</p>
    <p>It'll appear here once you start a plan. Type <code>/notebook</code> anytime to refresh.</p>
  </div>
`;

const ACTIVITY_EMPTY_HTML = `
  <div class="empty-state">
    <p>The activity log records every plan mutation and session event — a machine-readable timeline backing the notebook.</p>
    <p>Events will appear here as you work.</p>
  </div>
`;

type TabKey = "notebook" | "activity";

export class ArtifactPanel {
  private notebookEl: HTMLElement;
  private activityEl: HTMLElement;
  private tabButtons: HTMLButtonElement[];

  constructor() {
    this.notebookEl = document.getElementById("notebook-view")!;
    this.activityEl = document.getElementById("activity-view")!;
    this.tabButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#artifact-tabs .pane-tab"),
    );

    for (const btn of this.tabButtons) {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab as TabKey | undefined;
        if (tab) this.selectTab(tab);
      });
    }
  }

  /** Replace the notebook view with rendered markdown. */
  setNotebookMarkdown(markdown: string): void {
    this.notebookEl.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "result-block notebook-dump";
    const content = document.createElement("div");
    content.className = "result-markdown";
    content.innerHTML = notebookMarked.parse(markdown || "", { async: false }) as string;
    wrapper.appendChild(content);
    this.notebookEl.appendChild(wrapper);
  }

  /** Replace the activity view with the provided event timeline. */
  setActivityEvents(events: ShellActivityEvent[]): void {
    this.activityEl.innerHTML = "";
    if (!events || events.length === 0) {
      this.activityEl.innerHTML = ACTIVITY_EMPTY_HTML;
      return;
    }
    const list = document.createElement("div");
    list.className = "activity-timeline";
    for (const event of events) {
      list.appendChild(renderEvent(event));
    }
    this.activityEl.appendChild(list);
  }

  /** Switch the visible tab without touching the stored content. */
  selectTab(tab: TabKey): void {
    for (const btn of this.tabButtons) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    }
    this.notebookEl.classList.toggle("hidden", tab !== "notebook");
    this.activityEl.classList.toggle("hidden", tab !== "activity");
  }

  /** Reset both views to their initial empty states. */
  clear(): void {
    this.notebookEl.innerHTML = NOTEBOOK_EMPTY_HTML;
    this.activityEl.innerHTML = ACTIVITY_EMPTY_HTML;
    this.selectTab("notebook");
  }
}

function renderEvent(event: ShellActivityEvent): HTMLElement {
  const row = document.createElement("div");
  row.className = "activity-event";

  const header = document.createElement("div");
  header.className = "activity-event-header";

  const time = document.createElement("span");
  time.className = "activity-event-time";
  time.textContent = formatTime(event.timestamp);

  const kind = document.createElement("span");
  kind.className = "activity-event-kind";
  kind.textContent = event.kind;

  const source = document.createElement("span");
  source.className = "activity-event-source";
  source.textContent = event.source;

  header.appendChild(time);
  header.appendChild(kind);
  header.appendChild(source);
  row.appendChild(header);

  const body = document.createElement("pre");
  body.className = "activity-event-body hidden";
  try {
    body.textContent = JSON.stringify(event.payload, null, 2);
  } catch {
    body.textContent = String(event.payload);
  }
  row.appendChild(body);

  header.addEventListener("click", () => {
    body.classList.toggle("hidden");
  });

  return row;
}

function formatTime(iso: string): string {
  // Show HH:MM:SS in the user's local timezone. Falls back to the raw string
  // on invalid timestamps so a malformed event still renders.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
