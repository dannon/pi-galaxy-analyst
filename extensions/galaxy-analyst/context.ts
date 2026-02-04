/**
 * Context injection for Galaxy analysis plans
 *
 * Injects current plan state into the LLM context via the before_agent_start event.
 * Uses tiered injection: compact summary always, full details on demand via tools.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getCurrentPlan, getState, formatPlanSummary } from "./state";

export function setupContextInjection(pi: ExtensionAPI): void {

  // ─────────────────────────────────────────────────────────────────────────────
  // Inject plan context before agent starts processing
  // ─────────────────────────────────────────────────────────────────────────────
  pi.on("before_agent_start", async (_event, ctx) => {
    const plan = getCurrentPlan();
    const state = getState();

    if (!plan) {
      // No active plan - provide minimal guidance
      return {
        modifySystemPrompt: `
## Galaxy Analyst Status
No active analysis plan. To start a new analysis:
1. Discuss the research question and data with the researcher
2. Use \`analysis_plan_create\` to create a structured plan
3. Add steps with \`analysis_plan_add_step\`
4. Activate with \`analysis_plan_activate\` when ready

Galaxy connection: ${state.galaxyConnected ? 'Connected' : 'Not connected'}
${state.currentHistoryId ? `Current history: ${state.currentHistoryId}` : ''}
`
      };
    }

    // Active plan - inject summary
    const planSummary = formatPlanSummary(plan);

    return {
      modifySystemPrompt: `
## Current Analysis Plan

${planSummary}

## Analysis Protocol Reminders
- Get researcher approval before each step
- Log decisions with \`analysis_step_log\`
- Update step status with \`analysis_plan_update_step\`
- Create QC checkpoints with \`analysis_checkpoint\`
- Use \`analysis_plan_get\` for full plan details

Galaxy: ${state.galaxyConnected ? 'Connected' : 'Not connected'}
`
    };
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Update status bar after each turn
  // ─────────────────────────────────────────────────────────────────────────────
  pi.on("turn_end", async (_event, ctx) => {
    const plan = getCurrentPlan();

    if (plan) {
      const currentStep = plan.steps.find(s => s.status === 'in_progress');
      const completed = plan.steps.filter(s => s.status === 'completed').length;
      const total = plan.steps.length;

      const statusText = [
        `📋 ${plan.title}`,
        `[${completed}/${total}]`,
        currentStep ? `→ ${currentStep.name}` : plan.status === 'draft' ? '(draft)' : '',
      ].filter(Boolean).join(' ');

      ctx.ui.setStatus("galaxy-plan", statusText);
    } else {
      ctx.ui.setStatus("galaxy-plan", "🔬 Galaxy Analyst ready");
    }
  });
}

/**
 * Format connection status for display
 */
export function formatConnectionStatus(ctx: ExtensionContext): string[] {
  const state = getState();
  const lines: string[] = [];

  if (state.galaxyConnected) {
    lines.push("🟢 Connected to Galaxy");
    if (state.currentHistoryId) {
      lines.push(`   History: ${state.currentHistoryId}`);
    }
  } else {
    lines.push("⚪ Not connected to Galaxy");
    lines.push("   Use mcp__galaxy__connect to connect");
  }

  return lines;
}
