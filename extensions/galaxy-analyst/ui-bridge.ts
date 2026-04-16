/**
 * UI Bridge -- translates galaxy-analyst state changes into shell widgets.
 * Single emission path: state mutation -> onPlanChange -> setWidget.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AnalysisPlan, AnalysisStep } from "./types.js";
import { onPlanChange, formatPlanSummary } from "./state.js";

/** The step shape shells expect (e.g. the React step-graph renderer). */
export interface ShellStep {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  result?: string;
  command?: string;
}

function toShellStep(step: AnalysisStep): ShellStep {
  return {
    id: step.id,
    name: step.name,
    description: step.description,
    status: step.status,
    dependsOn: step.dependsOn,
    result: step.result?.summary,
    command: step.execution.toolId || step.execution.workflowId,
  };
}

/** Convert all steps in a plan. Exported for testing. */
export function toShellSteps(plan: AnalysisPlan): ShellStep[] {
  return plan.steps.map(toShellStep);
}

/**
 * Wire up the bridge. Captures the latest ExtensionContext from
 * before_agent_start so plan-change listeners can emit widgets.
 * Dirty-checks to avoid redundant IPC emissions.
 */
export function setupUIBridge(pi: ExtensionAPI): void {
  let latestCtx: ExtensionContext | null = null;
  let lastPlanMd = "";
  let lastStepsJson = "";

  pi.on("before_agent_start", async (_event, ctx) => {
    latestCtx = ctx;
  });

  onPlanChange((plan) => {
    if (!plan || !latestCtx) return;

    const md = formatPlanSummary(plan);
    const stepsJson = JSON.stringify(toShellSteps(plan));

    if (md !== lastPlanMd) {
      lastPlanMd = md;
      latestCtx.ui.setWidget("plan", md.split("\n"));
    }

    if (stepsJson !== lastStepsJson) {
      lastStepsJson = stepsJson;
      latestCtx.ui.setWidget("steps", [stepsJson]);
    }
  });
}
