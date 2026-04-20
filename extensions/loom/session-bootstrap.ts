import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  getCurrentPlan,
  restorePlan,
  resetState,
  findNotebooks,
  loadNotebook,
  isNotebookLoaded,
} from "./state.js";
import type { AnalysisPlan } from "./types.js";

export function registerSessionLifecycle(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setToolsExpanded(false);

    resetState();

    const freshSession = process.env.LOOM_FRESH_SESSION === "1";

    if (!freshSession) {
      await restoreSessionState(ctx);
    }

    if (freshSession || process.argv.includes("--continue")) {
      return;
    }

    sendStartupGreeting(pi);
  });

  pi.on("session_before_compact", async () => {
    const plan = getCurrentPlan();
    if (plan) {
      pi.appendEntry("galaxy_analyst_plan", plan);
    }
    return {};
  });

  pi.on("session_shutdown", async () => {
    const plan = getCurrentPlan();
    if (plan) {
      pi.appendEntry("galaxy_analyst_plan", plan);
    }
  });
}

async function restoreSessionState(ctx: ExtensionContext): Promise<void> {
  const cwd = process.cwd();

  try {
    const notebooks = await findNotebooks(cwd);

    if (notebooks.length === 1) {
      const plan = await loadNotebook(notebooks[0].path);
      if (plan) {
        const completed = plan.steps.filter((s) => s.status === "completed").length;
        ctx.ui.notify(
          `Loaded notebook: ${plan.title} (${completed}/${plan.steps.length} steps)`,
          "info"
        );
      }
    } else if (notebooks.length > 1) {
      ctx.ui.notify(
        `Found ${notebooks.length} notebooks. Use analysis_notebook_open to select one.`,
        "info"
      );
    }
  } catch {
    // Notebook loading failed, fall back to session entries.
  }

  try {
    if (!isNotebookLoaded()) {
      const entries = ctx.sessionManager?.getEntries?.() || [];
      const planEntries = entries.filter(
        (e) => e.type === "custom" && (e as { customType?: string }).customType === "galaxy_analyst_plan"
      );

      if (planEntries.length > 0) {
        const latestEntry = planEntries[planEntries.length - 1] as { data?: unknown };
        if (latestEntry.data) {
          restorePlan(latestEntry.data as AnalysisPlan);
          ctx.ui.notify(`Restored plan: ${(latestEntry.data as AnalysisPlan).title}`, "info");
        }
      }
    }
  } catch {
    // Session manager may not be available in all contexts.
  }
}

function sendStartupGreeting(pi: ExtensionAPI): void {
  const plan = getCurrentPlan();
  const hasCredentials = process.env.GALAXY_URL && process.env.GALAXY_API_KEY;

  // Galaxy MCP gets credentials via env vars -- no need to pass them through
  // the LLM. Just tell it to connect if credentials are configured.
  const connectInstr = hasCredentials
    ? ` Galaxy credentials are configured -- call galaxy_connect() to establish the connection.` +
      ` Do NOT call any other Galaxy tools until connected.`
    : "";

  if (plan) {
    const completed = plan.steps.filter((s) => s.status === "completed").length;
    const current = plan.steps.find((s) => s.status === "in_progress");
    const lastDecision = plan.decisions.length > 0
      ? plan.decisions[plan.decisions.length - 1]
      : null;
    const pendingReviews = plan.checkpoints.filter((c) => c.status === "needs_review");
    const nextPending = plan.steps.find((s) => s.status === "pending");

    let recapExtra = "";
    if (lastDecision) {
      recapExtra += ` Last decision: "${lastDecision.description}" (${lastDecision.type.replace(/_/g, " ")}).`;
    }
    if (pendingReviews.length > 0) {
      recapExtra += ` There are ${pendingReviews.length} QC checkpoint(s) awaiting review.`;
    }
    if (nextPending && !current) {
      recapExtra += ` Suggested next action: start step "${nextPending.name}".`;
    }

    // Orbit gets the terse, brand-stripped greeting (the app is opened many
    // times per day, so the chatty welcome adds friction). Other shells (CLI
    // for now) keep the friendlier prose. Future: per-shell first-time-user
    // welcome, richer onboarding, etc. -- see anton_pr_reviews / TODO.
    const isOrbit = process.env.LOOM_SHELL_KIND === "orbit";
    pi.sendUserMessage(
      `Session started with an existing analysis plan loaded: "${plan.title}" (${completed}/${plan.steps.length} steps complete` +
      `${current ? `, currently on: ${current.name}` : ""}).${recapExtra}` +
      (isOrbit
        ? ` Recap where we left off — what's been done, what's next, and any open questions. ` +
          `Keep it concise (a short paragraph, not a bulleted list). Do not use emojis or product branding.`
        : ` Give a brief welcome, then recap where we left off — what's been done, what's next, and any open questions. ` +
          `Keep it concise (a short paragraph, not a bulleted list).`) +
      connectInstr
    );
    return;
  }

  const isOrbit = process.env.LOOM_SHELL_KIND === "orbit";

  if (hasCredentials) {
    pi.sendUserMessage(
      `Session started, no existing analysis in this directory. ` +
      (isOrbit
        ? `Reply with exactly one short sentence: "What do you want to analyze?" ` +
          `No greeting, no emojis, no product branding.`
        : `Give a brief welcome to Loom, then ask what I'd like to work on — what research question or data do I have? ` +
          `Keep the greeting to 2-3 sentences.`) +
      connectInstr
    );
    return;
  }

  pi.sendUserMessage(
    `Session started, no existing analysis in this directory and no Galaxy server configured. ` +
    (isOrbit
      ? `Reply with two short sentences: mention I can use /connect to set up a Galaxy server, ` +
        `then ask "What do you want to analyze?". No greeting, no emojis, no product branding.`
      : `Give a brief welcome to Loom, mention I can use /connect to set up a Galaxy server, ` +
        `and ask what I'd like to work on. Keep it to 2-3 sentences.`)
  );
}
