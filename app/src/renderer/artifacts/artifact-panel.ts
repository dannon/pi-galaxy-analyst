/**
 * ArtifactPanel manages the right pane: Plan, Steps, Results tabs.
 *
 * Plan has three modes:
 * - Rendered: markdown rendered as HTML (read-only, default)
 * - Raw: editable textarea for direct editing
 * - Parameters: form view (Phase 4) — replaces plan rendered/raw when active
 */

import { marked } from "marked";
import { ParameterForm, type ParameterFormSpec } from "./parameter-form.js";

export interface PlanStep {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  description?: string;
}

interface ResultBlock {
  stepName?: string;
  type: "markdown" | "table" | "image" | "file";
  content?: string;
  headers?: string[];
  rows?: string[][];
  path?: string;
  caption?: string;
}

export class ArtifactPanel {
  private planEl: HTMLElement;
  private stepsEl: HTMLElement;
  private resultsEl: HTMLElement;

  private renderedEl: HTMLElement;
  private rawEl: HTMLTextAreaElement;
  private toolbarEl: HTMLElement;
  private actionsEl: HTMLElement;

  // Phase 4: parameter form view
  private paramsViewEl: HTMLElement;
  private paramsFormEl: HTMLElement;
  private parameterForm: ParameterForm;

  private planContent = "";
  private mode: "rendered" | "raw" = "rendered";
  private paramsActive = false;
  private savedParams: Record<string, string | number | boolean> | null = null;

  constructor() {
    this.planEl = document.getElementById("tab-plan")!;
    this.stepsEl = document.getElementById("tab-steps")!;
    this.resultsEl = document.getElementById("tab-results")!;

    this.renderedEl = document.getElementById("plan-rendered")!;
    this.rawEl = document.getElementById("plan-raw") as HTMLTextAreaElement;
    this.toolbarEl = document.getElementById("plan-toolbar")!;
    this.actionsEl = document.getElementById("plan-actions")!;

    this.paramsViewEl = document.getElementById("plan-params-view")!;
    this.paramsFormEl = document.getElementById("plan-params-form")!;
    this.parameterForm = new ParameterForm(this.paramsFormEl);

    this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const newMode = btn.dataset.mode as "rendered" | "raw";
        this.setMode(newMode);
      });
    });

    this.rawEl.addEventListener("input", () => {
      this.planContent = this.rawEl.value;
    });
  }

  setPlanText(text: string): void {
    this.planContent = text;

    const empty = this.planEl.querySelector(".empty-state");
    if (empty) empty.remove();

    this.toolbarEl.classList.remove("hidden");
    this.actionsEl.classList.remove("hidden");

    // Exit parameters view if it was showing — new plan supersedes old form
    if (this.paramsActive) this.hideParameters();

    this.render();
  }

  getPlanText(): string {
    return this.planContent;
  }

  // ── Parameter form (Phase 4) ────────────────────────────────────────────────

  /** Show the parameter form, hiding the plan rendered/raw view. */
  showParameters(spec: ParameterFormSpec): void {
    this.parameterForm.render(spec);
    this.paramsActive = true;

    // Hide plan rendered/raw + toolbar + main action buttons
    this.renderedEl.classList.add("hidden");
    this.rawEl.classList.add("hidden");
    this.toolbarEl.classList.add("hidden");
    this.actionsEl.classList.add("hidden");

    // Show parameter view
    this.paramsViewEl.classList.remove("hidden");
  }

  /** Return to the plan view, preserving form values for next show. */
  hideParameters(): void {
    this.paramsActive = false;
    this.paramsViewEl.classList.add("hidden");

    // Restore plan view
    this.toolbarEl.classList.remove("hidden");
    this.actionsEl.classList.remove("hidden");
    this.render();
  }

  getParameterValues(): Record<string, string | number | boolean> {
    return this.parameterForm.getValues();
  }

  isParametersActive(): boolean {
    return this.paramsActive;
  }

  hasParameterSpec(): boolean {
    return this.parameterForm.hasSpec();
  }

  /** Snapshot current form values so they survive navigating away. */
  saveParameters(): void {
    this.savedParams = this.getParameterValues();
  }

  getSavedParameters(): Record<string, string | number | boolean> | null {
    return this.savedParams;
  }

  hasSavedParameters(): boolean {
    return this.savedParams !== null;
  }

  setParametersDisabled(disabled: boolean): void {
    this.parameterForm.setDisabled(disabled);
  }

  private setMode(mode: "rendered" | "raw"): void {
    if (this.mode === "raw") {
      this.planContent = this.rawEl.value;
    }

    this.mode = mode;

    this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });

    this.render();
  }

  private render(): void {
    if (this.mode === "rendered") {
      this.renderedEl.innerHTML = marked.parse(this.planContent, { async: false }) as string;
      this.renderedEl.classList.remove("hidden");
      this.rawEl.classList.add("hidden");
    } else {
      this.rawEl.value = this.planContent;
      this.rawEl.classList.remove("hidden");
      this.renderedEl.classList.add("hidden");
    }
  }

  setSteps(steps: PlanStep[]): void {
    this.stepsEl.innerHTML = "";

    if (steps.length === 0) {
      this.stepsEl.innerHTML = '<div class="empty-state">No steps yet.</div>';
      return;
    }

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "8px";

    for (const step of steps) {
      const node = document.createElement("div");
      node.className = `step-node ${step.status}`;
      node.innerHTML = `
        <span class="step-icon ${step.status}"></span>
        <span>${escapeHtml(step.name)}</span>
      `;
      if (step.description) {
        node.title = step.description;
      }
      list.appendChild(node);

      if (step !== steps[steps.length - 1]) {
        const arrow = document.createElement("div");
        arrow.style.textAlign = "center";
        arrow.style.color = "var(--text-dim)";
        arrow.style.fontSize = "16px";
        arrow.textContent = "\u2193";
        list.appendChild(arrow);
      }
    }

    this.stepsEl.appendChild(list);
  }

  /** Add a typed result block to the Results tab. */
  addResultBlock(block: ResultBlock): void {
    const empty = this.resultsEl.querySelector(".empty-state");
    if (empty) empty.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "result-block";

    // Step name header
    if (block.stepName) {
      const header = document.createElement("div");
      header.className = "result-step-header";
      header.textContent = block.stepName;
      wrapper.appendChild(header);
    }

    switch (block.type) {
      case "markdown": {
        const content = document.createElement("div");
        content.className = "result-markdown";
        content.innerHTML = marked.parse(block.content || "", { async: false }) as string;
        wrapper.appendChild(content);
        break;
      }

      case "table": {
        if (block.headers && block.rows) {
          const table = document.createElement("table");
          table.className = "result-table";

          const thead = document.createElement("thead");
          const headerRow = document.createElement("tr");
          for (const h of block.headers) {
            const th = document.createElement("th");
            th.textContent = h;
            headerRow.appendChild(th);
          }
          thead.appendChild(headerRow);
          table.appendChild(thead);

          const tbody = document.createElement("tbody");
          for (const row of block.rows) {
            const tr = document.createElement("tr");
            for (const cell of row) {
              const td = document.createElement("td");
              td.textContent = cell;
              tr.appendChild(td);
            }
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          wrapper.appendChild(table);
        }
        break;
      }

      case "image": {
        if (block.path) {
          const img = document.createElement("img");
          img.className = "result-image";
          img.src = `file://${block.path}`;
          img.alt = block.caption || "";
          wrapper.appendChild(img);

          if (block.caption) {
            const cap = document.createElement("div");
            cap.className = "result-caption";
            cap.textContent = block.caption;
            wrapper.appendChild(cap);
          }
        }
        break;
      }

      case "file": {
        if (block.path) {
          const link = document.createElement("a");
          link.className = "result-file-link";
          link.href = "#";
          link.textContent = block.caption || block.path;
          link.title = block.path;
          link.addEventListener("click", (e) => {
            e.preventDefault();
            window.orbit.openFile(block.path!);
          });
          wrapper.appendChild(link);
        }
        break;
      }
    }

    this.resultsEl.appendChild(wrapper);
  }

  addResult(html: string): void {
    const empty = this.resultsEl.querySelector(".empty-state");
    if (empty) empty.remove();

    const el = document.createElement("div");
    el.style.marginBottom = "16px";
    el.innerHTML = html;
    this.resultsEl.appendChild(el);
  }

  clearResults(): void {
    this.resultsEl.innerHTML = '<div class="empty-state">Results will appear here as the analysis runs.</div>';
  }

  /** Replace the Notebook tab with rendered markdown (used by /notebook). */
  setNotebookMarkdown(markdown: string): void {
    this.resultsEl.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "result-block notebook-dump";
    const content = document.createElement("div");
    content.className = "result-markdown";
    content.innerHTML = marked.parse(markdown || "", { async: false }) as string;
    wrapper.appendChild(content);
    this.resultsEl.appendChild(wrapper);
  }

  /** Reset all tabs to their initial empty state. */
  clear(): void {
    // Plan tab
    this.planContent = "";
    this.mode = "rendered";
    this.savedParams = null;
    if (this.paramsActive) this.hideParameters();
    this.renderedEl.innerHTML = "";
    this.renderedEl.classList.add("hidden");
    this.rawEl.value = "";
    this.rawEl.classList.add("hidden");
    this.toolbarEl.classList.add("hidden");
    this.actionsEl.classList.add("hidden");
    // Restore plan empty state if missing
    if (!this.planEl.querySelector(".empty-state")) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No analysis plan yet. To create a plan begin your conversation with 'Create a plan for analysis of ...'. For examples, use '/help'.";
      this.planEl.insertBefore(empty, this.planEl.firstChild);
    }

    // Steps tab
    this.stepsEl.innerHTML = '<div class="empty-state">Pipeline steps will appear here once a plan is created.</div>';

    // Results tab
    this.clearResults();
  }
}

function escapeHtml(text: string): string {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}
