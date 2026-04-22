/**
 * Loom — Galaxy co-scientist extension for Pi.dev.
 *
 * Brain-side runtime that plan-orchestrates Galaxy bioinformatics analyses.
 * Manages analysis state, registers custom tools, and injects context.
 * Consumed by shells (the Loom CLI, the Orbit Electron app, future web UIs).
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerPlanTools } from "./tools";
import { setupContextInjection } from "./context";
import { setupUIBridge } from "./ui-bridge";
import { registerSessionLifecycle } from "./session-bootstrap";
import { registerActivityHooks } from "./activity-hooks";
import { registerExecutionCommands } from "./execution-commands";
import { registerTeamTools } from "./teams/tool";
import { isTeamDispatchEnabled } from "./teams/is-enabled";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  getState,
  getCurrentPlan,
  findNotebooks,
  getNotebookPath,
} from "./state";
import {
  loadProfiles,
  saveProfile,
  switchProfile,
  profileNameFromUrl,
} from "./profiles";
import { LoomWidgetKey, encodeMarkdownWidget } from "../../shared/loom-shell-contract.js";

export default function galaxyAnalystExtension(pi: ExtensionAPI): void {

  // ─────────────────────────────────────────────────────────────────────────────
  // UI bridge: structured plan events for shell consumers
  // ─────────────────────────────────────────────────────────────────────────────
  setupUIBridge(pi);
  registerSessionLifecycle(pi);
  registerActivityHooks(pi);


  // ─────────────────────────────────────────────────────────────────────────────
  // Register custom tools for plan management
  // ─────────────────────────────────────────────────────────────────────────────
  registerPlanTools(pi);
  registerExecutionCommands(pi);
  if (isTeamDispatchEnabled()) {
    registerTeamTools(pi);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Set up context injection
  // ─────────────────────────────────────────────────────────────────────────────
  setupContextInjection(pi);

  // ─────────────────────────────────────────────────────────────────────────────
  // Register /plan command for quick plan access
  // ─────────────────────────────────────────────────────────────────────────────
  pi.registerCommand("plan", {
    description: "View current analysis plan summary",
    handler: async (_args, ctx) => {
      const plan = getCurrentPlan();

      if (!plan) {
        ctx.ui.notify("No active analysis plan", "warning");
        return;
      }

      const phaseLabels: Record<string, string> = {
        problem_definition: 'Problem Definition',
        data_acquisition: 'Data Acquisition',
        analysis: 'Analysis',
        interpretation: 'Interpretation',
        publication: 'Publication',
      };

      const phaseOrder = ['problem_definition', 'data_acquisition', 'analysis', 'interpretation', 'publication'];
      const phaseIdx = phaseOrder.indexOf(plan.phase);

      // Build summary display
      const lines: string[] = [];
      lines.push(`📋 ${plan.title} [${plan.status}]`);
      lines.push(`   ${plan.context.researchQuestion.slice(0, 60)}${plan.context.researchQuestion.length > 60 ? '...' : ''}`);
      lines.push('');

      // Phase progress
      const phaseBar = phaseOrder.map((p, i) => {
        if (i < phaseIdx) return '●';
        if (i === phaseIdx) return '◉';
        return '○';
      }).join('─');
      lines.push(`   Phase: ${phaseBar}  ${phaseLabels[plan.phase] || plan.phase}`);
      lines.push('');

      // Steps with completion info
      for (const step of plan.steps) {
        const icon = {
          'pending': '⬜',
          'in_progress': '🔄',
          'completed': '✅',
          'skipped': '⏭️',
          'failed': '❌',
        }[step.status];
        let extra = '';
        if (step.result?.completedAt) {
          const elapsed = timeSince(step.result.completedAt);
          extra = ` (${elapsed} ago)`;
        }
        lines.push(`   ${icon} ${step.id}. ${step.name}${extra}`);
      }

      // Stats
      const completed = plan.steps.filter(s => s.status === 'completed').length;
      lines.push('');
      lines.push(`   Progress: ${completed}/${plan.steps.length} steps completed`);
      lines.push(`   Decisions: ${plan.decisions.length} logged`);
      lines.push(`   Checkpoints: ${plan.checkpoints.length}`);

      // Last QC checkpoint
      const lastCp = [...plan.checkpoints].reverse().find(c => c.status !== 'pending');
      if (lastCp) {
        const cpIcon = lastCp.status === 'passed' ? '✅' : lastCp.status === 'failed' ? '❌' : '⚠️';
        lines.push(`   Last QC: ${cpIcon} ${lastCp.name} (${lastCp.status.replace('_', ' ')})`);
      }

      // Pending decisions (not yet approved)
      const pendingDecisions = plan.decisions.filter(d => !d.researcherApproved);
      if (pendingDecisions.length > 0) {
        lines.push(`   ⚠️  ${pendingDecisions.length} decision(s) pending approval`);
      }

      ctx.ui.setWidget(LoomWidgetKey.PlanView, encodeMarkdownWidget(lines.join("\n")));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Register /plan-decisions command to view decision log
  // ─────────────────────────────────────────────────────────────────────────────
  pi.registerCommand("plan-decisions", {
    description: "View recent decisions in the analysis plan",
    handler: async (_args, ctx) => {
      const plan = getCurrentPlan();

      if (!plan) {
        ctx.ui.notify("No active analysis plan", "warning");
        return;
      }

      if (plan.decisions.length === 0) {
        ctx.ui.notify("No decisions logged yet", "info");
        return;
      }

      const lines: string[] = ["📝 Decision Log", ""];

      // Show last 10 decisions
      const recent = plan.decisions.slice(-10);
      for (const d of recent) {
        const date = new Date(d.timestamp).toLocaleString();
        const stepInfo = d.stepId ? ` (Step ${d.stepId})` : '';
        const approved = d.researcherApproved ? '✓' : '?';

        lines.push(`[${d.type}]${stepInfo} ${approved}`);
        lines.push(`  ${d.description.slice(0, 70)}${d.description.length > 70 ? '...' : ''}`);
        lines.push(`  ${date}`);
        lines.push('');
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Register /connect command for Galaxy connection with profile support
  // ─────────────────────────────────────────────────────────────────────────────
  pi.registerCommand("connect", {
    description: "Connect to Galaxy server. Use /connect to pick a profile or add a new one, /connect <name> to switch.",
    handler: async (args, ctx) => {
      const { profiles, active } = loadProfiles();
      const profileNames = Object.keys(profiles);

      // After switching profiles, reload extensions so the session_start
      // handler auto-connects with the new credentials. Falls back to
      // sendUserMessage if reload() isn't available.
      async function reloadOrMessage(url: string) {
        if (typeof ctx.reload === 'function') {
          await ctx.reload();
        } else {
          pi.sendUserMessage(
            `Please connect to Galaxy at ${url} using the API key from environment variables.`
          );
        }
      }

      // /connect <name> — switch to a named profile
      const requestedName = args?.trim();
      if (requestedName) {
        if (switchProfile(requestedName)) {
          ctx.ui.notify(`Switched to ${requestedName} (${profiles[requestedName].url})`, "info");
          await reloadOrMessage(profiles[requestedName].url);
        } else {
          ctx.ui.notify(`Unknown profile "${requestedName}". Use /profiles to see available profiles.`, "warning");
        }
        return;
      }

      // /connect (no args) — depends on how many profiles exist
      if (profileNames.length > 1) {
        // Multiple profiles: let user pick or add a new server
        const choices = profileNames.map(name => {
          const marker = name === active ? "* " : "  ";
          return `${marker}${name} (${profiles[name].url})`;
        });
        choices.push("  Add new server...");

        const selection = await ctx.ui.select("Select Galaxy server", choices);
        if (selection === undefined || selection === null) {
          ctx.ui.notify("Connection cancelled", "warning");
          return;
        }

        const selectedIndex = typeof selection === 'number' ? selection : choices.indexOf(selection);

        if (selectedIndex >= 0 && selectedIndex < profileNames.length) {
          // Picked an existing profile
          const name = profileNames[selectedIndex];
          switchProfile(name);
          ctx.ui.notify(`Switched to ${name} (${profiles[name].url})`, "info");
          await reloadOrMessage(profiles[name].url);
          return;
        }
        // Fall through to "add new server" flow below
      } else if (profileNames.length === 1 && active && process.env.GALAXY_URL && process.env.GALAXY_API_KEY) {
        // One profile, already active — just connect
        ctx.ui.notify(`Connecting to ${profiles[active].url}...`, "info");
        await reloadOrMessage(profiles[active].url);
        return;
      }

      // No profiles, or user chose "Add new server" — prompt for credentials
      const galaxyUrl = await ctx.ui.input(
        "Galaxy Server URL",
        "https://usegalaxy.org"
      );
      if (!galaxyUrl) {
        ctx.ui.notify("Connection cancelled", "warning");
        return;
      }

      ctx.ui.notify(
        "To get your API key: Log into Galaxy → User → Preferences → Manage API Key",
        "info"
      );
      const apiKey = await ctx.ui.input("Galaxy API Key");
      if (!apiKey) {
        ctx.ui.notify("Connection cancelled - API key required", "warning");
        return;
      }

      // Save as a new profile
      const name = profileNameFromUrl(galaxyUrl);
      saveProfile(name, galaxyUrl, apiKey);

      process.env.GALAXY_URL = galaxyUrl;
      process.env.GALAXY_API_KEY = apiKey;

      ctx.ui.notify(`Saved profile "${name}" and connecting to ${galaxyUrl}...`, "info");
      await reloadOrMessage(galaxyUrl);
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Register /profiles command to list saved Galaxy server profiles
  // ─────────────────────────────────────────────────────────────────────────────
  pi.registerCommand("profiles", {
    description: "List saved Galaxy server profiles",
    handler: async (_args, ctx) => {
      const { profiles, active } = loadProfiles();
      const names = Object.keys(profiles);

      if (names.length === 0) {
        ctx.ui.notify("No saved profiles. Use /connect to add one.", "info");
        return;
      }

      const lines: string[] = ["Galaxy Server Profiles", ""];
      for (const name of names) {
        const marker = name === active ? "*" : " ";
        lines.push(`  ${marker} ${name} (${profiles[name].url})`);
      }
      lines.push("");
      lines.push("Use /connect <name> to switch, or /connect to add a new server.");

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Register /status command for quick Galaxy status check
  // ─────────────────────────────────────────────────────────────────────────────
  pi.registerCommand("status", {
    description: "Show Galaxy connection and plan status",
    handler: async (_args, ctx) => {
      const state = getState();
      const plan = getCurrentPlan();

      const lines: string[] = [];
      lines.push("🔬 Loom Status");
      lines.push("");

      // Connection status
      if (state.galaxyConnected) {
        lines.push(`✅ Connected to Galaxy`);
        if (process.env.GALAXY_URL) {
          lines.push(`   Server: ${process.env.GALAXY_URL}`);
        }
        if (state.currentHistoryId) {
          lines.push(`   History: ${state.currentHistoryId}`);
        }
      } else {
        lines.push("⚪ Not connected to Galaxy");
        lines.push("   Use /connect or ask to connect");
      }

      lines.push("");

      // Plan status
      if (plan) {
        const completed = plan.steps.filter(s => s.status === 'completed').length;
        const current = plan.steps.find(s => s.status === 'in_progress');
        lines.push(`📋 Plan: ${plan.title}`);
        lines.push(`   Status: ${plan.status}`);
        lines.push(`   Progress: ${completed}/${plan.steps.length} steps`);
        if (current) {
          lines.push(`   Current: ${current.name}`);
        }
      } else {
        lines.push("📋 No active plan");
        lines.push("   Start by describing your analysis");
      }

      // Notebook status
      lines.push("");
      const notebookPath = getNotebookPath();
      if (notebookPath) {
        lines.push(`📓 Notebook: ${notebookPath}`);
      } else {
        lines.push("📓 No notebook (in-memory only)");
        lines.push("   Use analysis_notebook_create to persist");
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Register /notebook command for quick notebook access
  // ─────────────────────────────────────────────────────────────────────────────
  pi.registerCommand("notebook", {
    description: "View current notebook content or list available notebooks",
    handler: async (_args, ctx) => {
      const notebookPath = getNotebookPath();

      // Active notebook: dump the live markdown file (plan + steps + decisions +
      // galaxy refs), preceded by a short header. Shells route "notebook" to
      // their Notebook tab.
      if (notebookPath && fs.existsSync(notebookPath)) {
        let content = "";
        try {
          content = fs.readFileSync(notebookPath, "utf-8");
        } catch (err) {
          ctx.ui.notify(`Failed to read notebook: ${err}`, "error");
          return;
        }
        const header = `> \`${notebookPath}\`\n\n`;
        ctx.ui.setWidget(LoomWidgetKey.Notebook, encodeMarkdownWidget(header + content));
        return;
      }

      // No active notebook: surface what's in the working dir so the user
      // can decide whether to open one.
      const cwd = process.cwd();
      const notebooks = await findNotebooks(cwd);

      const lines: string[] = ["# 📓 No notebook loaded", ""];
      if (notebooks.length > 0) {
        lines.push(`Found ${notebooks.length} notebook(s) in \`${cwd}\`:`, "");
        for (const nb of notebooks) {
          lines.push(`- **${nb.title}** — \`${nb.path}\` (${nb.completedSteps}/${nb.stepCount} steps, ${nb.status})`);
        }
        lines.push("", "Use `analysis_notebook_open` to load one.");
      } else {
        lines.push(`No notebooks found in \`${cwd}\`.`, "", "Create a plan, then use `analysis_notebook_create`.");
      }
      ctx.ui.setWidget(LoomWidgetKey.Notebook, encodeMarkdownWidget(lines.join("\n")));
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool execution lifecycle: show status when Galaxy tools run
  // ─────────────────────────────────────────────────────────────────────────────
  const toolStartTimes = new Map<string, number>();

  pi.on("tool_execution_start", async (event, ctx) => {
    if (event.toolName?.startsWith("galaxy_")) {
      const label = event.toolName.replace(/^galaxy_/, "").replace(/_/g, " ");
      toolStartTimes.set(event.toolName, Date.now());
      ctx.ui.setStatus("galaxy-tool", `🔧 Running ${label}...`);
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (event.toolName?.startsWith("galaxy_")) {
      const startTime = toolStartTimes.get(event.toolName);
      if (startTime) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const label = event.toolName.replace(/^galaxy_/, "").replace(/_/g, " ");
        ctx.ui.setStatus("galaxy-tool", `✓ ${label} (${elapsed}s)`);
        toolStartTimes.delete(event.toolName);
        // Clear after a brief display
        setTimeout(() => ctx.ui.setStatus("galaxy-tool", ""), 3000);
      } else {
        ctx.ui.setStatus("galaxy-tool", "");
      }
    }

    // Track galaxy_connect success
    if (event.toolName === "galaxy_connect" && !event.isError) {
      try {
        const resultText = typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result);
        if (resultText.includes('"success": true') || resultText.includes('success')) {
          const state = getState();
          state.galaxyConnected = true;
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // Track history creation
    if (event.toolName === "galaxy_create_history" && !event.isError) {
      try {
        const resultText = typeof event.result === 'string'
          ? event.result
          : JSON.stringify(event.result);
        const match = resultText.match(/"id":\s*"([^"]+)"/);
        if (match) {
          const state = getState();
          state.currentHistoryId = match[1];
          const plan = getCurrentPlan();
          if (plan) {
            plan.galaxy.historyId = match[1];
          }
        }
      } catch {
        // Ignore parsing errors
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Monitor tool calls for Galaxy connection state (fallback for tool_result)
  // ─────────────────────────────────────────────────────────────────────────────
  pi.on("tool_result", async (event, _ctx) => {
    // Watch for galaxy connect results to update our state
    if (event.toolName === "galaxy_connect") {
      try {
        const firstContent = event.content?.[0];
        const resultText = firstContent && 'text' in firstContent ? firstContent.text : undefined;
        if (resultText && resultText.includes('"success": true')) {
          const state = getState();
          state.galaxyConnected = true;
        }
      } catch {
        // Ignore parsing errors
      }
    }

    // Watch for history creation
    if (event.toolName === "galaxy_create_history") {
      try {
        const firstContent = event.content?.[0];
        const resultText = firstContent && 'text' in firstContent ? firstContent.text : undefined;
        if (resultText) {
          const match = resultText.match(/"id":\s*"([^"]+)"/);
          if (match) {
            const state = getState();
            state.currentHistoryId = match[1];
            const plan = getCurrentPlan();
            if (plan) {
              plan.galaxy.historyId = match[1];
            }
          }
        }
      } catch {
        // Ignore parsing errors
      }
    }
  });

}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
