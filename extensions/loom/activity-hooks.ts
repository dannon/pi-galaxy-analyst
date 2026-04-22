/**
 * Activity hooks — stream user prompts and tool calls into activity.jsonl.
 *
 * Mirrors the conversation into the session's append-only activity log so the
 * Activity pane reflects every non-trivial interaction, not just plan
 * mutations. Guarded on `getNotebookPath()` so nothing writes before
 * `initSessionArtifacts()` has set up the session dir.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as path from "path";
import { getNotebookPath } from "./state";
import { appendActivityEvent } from "./activity";

// Read-only / filesystem-traversal tools clutter the log without telling the
// user anything they'd want to re-read later. Omit them.
const NOISY_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "find",
]);

const RESULT_SUMMARY_MAX = 500;

function sessionDir(): string | null {
  const nb = getNotebookPath();
  return nb ? path.dirname(nb) : null;
}

function summarizeResult(result: unknown): string {
  if (result == null) return "";
  const str = typeof result === "string" ? result : JSON.stringify(result);
  if (str.length <= RESULT_SUMMARY_MAX) return str;
  return str.slice(0, RESULT_SUMMARY_MAX) + `… [truncated ${str.length - RESULT_SUMMARY_MAX} chars]`;
}

export function registerActivityHooks(pi: ExtensionAPI): void {
  pi.on("input", async (event) => {
    const dir = sessionDir();
    if (!dir) return;
    appendActivityEvent(dir, {
      timestamp: new Date().toISOString(),
      kind: "user.prompt",
      source: event.source,
      payload: { text: event.text },
    });
    return { action: "continue" };
  });

  pi.on("tool_execution_start", async (event) => {
    if (NOISY_TOOLS.has(event.toolName)) return;
    const dir = sessionDir();
    if (!dir) return;
    appendActivityEvent(dir, {
      timestamp: new Date().toISOString(),
      kind: "tool.start",
      source: "agent",
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      },
    });
  });

  pi.on("tool_execution_end", async (event) => {
    if (NOISY_TOOLS.has(event.toolName)) return;
    const dir = sessionDir();
    if (!dir) return;
    appendActivityEvent(dir, {
      timestamp: new Date().toISOString(),
      kind: "tool.end",
      source: "agent",
      payload: {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        resultSummary: summarizeResult(event.result),
      },
    });
  });
}
