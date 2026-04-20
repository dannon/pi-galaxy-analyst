export interface LoomConfig {
  llm?: {
    provider?: string;
    apiKey?: string;
    model?: string;
  };
  galaxy?: {
    active: string | null;
    profiles: Record<string, { url: string; apiKey: string }>;
  };
  executionMode?: "local" | "remote";
  defaultCwd?: string;
  /**
   * Absolute path to a gxy-sketches checkout. When set, Loom scans the
   * corpus for sketches matching the active plan (by tool IDs, workflow
   * ID, or tags) and injects the content into the system prompt.
   */
  sketchCorpusPath?: string;
  /**
   * Opt-in flags for experimental subsystems. Off by default; set the
   * matching env var (e.g. LOOM_TEAM_DISPATCH=1) to override per-session.
   */
  experiments?: {
    /** Register the experimental team_dispatch tool and its prompt guidance. */
    teamDispatch?: boolean;
    /**
     * Register the experimental session-index tools (chat_search,
     * chat_session_context, chat_find_tool_calls) that query Pi's JSONL
     * session corpus via a SQLite+FTS5 mirror at ~/.loom/sessions-index.db.
     */
    sessionIndex?: boolean;
  };
}

export function getConfigDir(): string;
export function getConfigPath(): string;
export function loadConfig(): LoomConfig;
export function saveConfig(config: LoomConfig): void;
