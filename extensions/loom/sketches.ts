/**
 * Loader for gxy-sketches corpus -- Anton's static analysis-scaffolding
 * sketches authored at github.com/nekrut/gxy-sketches.
 *
 * Loom treats sketches as a knowledge layer: when an active plan's tools,
 * workflow, or tags match a sketch, its body is injected into the system
 * prompt so the agent has domain grounding for that class of analysis.
 *
 * We only parse the subset of the SketchFrontmatter schema we actually
 * need for matching and rendering. Unknown fields are tolerated so schema
 * drift upstream doesn't break sketch loading here.
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";
import type { AnalysisPlan } from "./types";

/** Cap on a single sketch's size on disk. Oversized files are skipped. */
const MAX_SKETCH_BYTES = 200 * 1024;

export interface SketchToolRef {
  name: string;
  version?: string;
}

export interface SketchExpectedOutput {
  role?: string;
  description?: string;
  assertions?: string[];
}

export interface SketchFrontmatter {
  name: string;
  description?: string;
  domain?: string;
  tags?: string[];
  tools?: SketchToolRef[];
  source?: {
    ecosystem?: string;
    workflow?: string;
    url?: string;
    version?: string;
  };
  expected_output?: SketchExpectedOutput[];
}

export interface LoadedSketch {
  filePath: string;
  frontmatter: SketchFrontmatter;
  body: string;
}

export interface MatchedSketch extends LoadedSketch {
  score: number;
  reason: string;
}

/**
 * Walk the corpus directory and return every sketch we could load.
 * Malformed files emit a warning and are skipped rather than throwing.
 */
export function loadSketchCorpus(corpusRoot: string): LoadedSketch[] {
  if (!corpusRoot) return [];
  if (!fs.existsSync(corpusRoot) || !fs.statSync(corpusRoot).isDirectory()) {
    return [];
  }

  const sketches: LoadedSketch[] = [];
  const sketchesRoot = path.join(corpusRoot, "sketches");
  const scanRoot = fs.existsSync(sketchesRoot) ? sketchesRoot : corpusRoot;

  for (const filePath of walkForSketchFiles(scanRoot)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_SKETCH_BYTES) {
        console.warn(`[sketches] skipping ${filePath}: exceeds ${MAX_SKETCH_BYTES} bytes`);
        continue;
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = parseSketch(raw);
      if (!parsed) {
        console.warn(`[sketches] skipping ${filePath}: missing or malformed frontmatter`);
        continue;
      }

      sketches.push({ filePath, ...parsed });
    } catch (err) {
      console.warn(`[sketches] failed to read ${filePath}:`, err);
    }
  }

  return sketches;
}

/**
 * Parse a sketch markdown file into its frontmatter + body.
 * Returns null if the frontmatter is missing or lacks the required `name`.
 */
export function parseSketch(
  raw: string,
): { frontmatter: SketchFrontmatter; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = parseYamlFrontmatter(match[1]);
  if (!frontmatter || !frontmatter.name) return null;

  return { frontmatter, body: match[2].trim() };
}

/**
 * Rank loaded sketches against a plan. Returns matches sorted strongest-first;
 * the caller can slice to top-N. Empty array if no signal.
 *
 * Priority signal: exact source.workflow id match > tool-id overlap > tag overlap.
 */
export function matchSketchesForPlan(
  plan: AnalysisPlan,
  sketches: LoadedSketch[],
): MatchedSketch[] {
  const planToolIds = new Set<string>();
  const planToolShortNames = new Set<string>();
  const planToolPrefixes = new Set<string>();
  for (const step of plan.steps) {
    const id = step.execution.toolId;
    if (!id) continue;
    planToolIds.add(id);
    const short = shortToolName(id);
    planToolShortNames.add(short);
    const prefix = toolPrefix(short);
    if (prefix) planToolPrefixes.add(prefix);
  }

  const planWorkflowId = plan.steps
    .map((s) => s.execution.workflowId)
    .find((id): id is string => Boolean(id));

  const planTags = new Set<string>();
  if (plan.brcContext?.analysisCategory) {
    planTags.add(plan.brcContext.analysisCategory.toLowerCase());
  }

  // Tokenize the prose on the plan -- research question, data description,
  // title, step names and descriptions -- so a sketch's tags, domain, or
  // name tokens can match against what the researcher actually wrote, not
  // just against tool ids. Keeps matching useful before any tool steps are
  // even added to the plan.
  const planKeywords = extractPlanKeywords(plan);

  const matched: MatchedSketch[] = [];
  for (const sketch of sketches) {
    const { frontmatter } = sketch;

    let score = 0;
    const reasons: string[] = [];

    if (planWorkflowId && frontmatter.source?.workflow === planWorkflowId) {
      score += 100;
      reasons.push("exact workflow match");
    }

    const toolHits = (frontmatter.tools || []).filter((t) => {
      return planToolIds.has(t.name) || planToolShortNames.has(t.name);
    });
    if (toolHits.length > 0) {
      score += toolHits.length * 10;
      reasons.push(`${toolHits.length} tool match(es)`);
    }

    // Tool-id prefix overlap catches same-family tools that aren't identical.
    // e.g. sketch lists `alphagenome_ism_scanner`, plan has
    // `alphagenome_variant_scorer` -- shared `alphagenome` prefix is a real
    // signal. Requires prefix length >= 5 to avoid matching on "report_".
    const sketchPrefixes = new Set(
      (frontmatter.tools || [])
        .map((t) => toolPrefix(t.name))
        .filter((p): p is string => Boolean(p)),
    );
    const prefixHits = [...sketchPrefixes].filter((p) => planToolPrefixes.has(p));
    // Only credit prefix hits that didn't already land as full tool hits.
    const prefixOnlyHits = prefixHits.filter(
      (p) => !toolHits.some((t) => toolPrefix(t.name) === p),
    );
    if (prefixOnlyHits.length > 0) {
      score += prefixOnlyHits.length * 3;
      reasons.push(`${prefixOnlyHits.length} tool-family match(es)`);
    }

    const tagHits = (frontmatter.tags || []).filter((tag) => {
      return planTags.has(tag.toLowerCase()) || tagMatches(tag, planKeywords);
    });
    if (tagHits.length > 0) {
      score += tagHits.length * 2;
      reasons.push(`${tagHits.length} tag match(es)`);
    }

    // Sketch name tokens (e.g. "alphagenome-gwas-regulatory" -> {alphagenome,
    // gwas, regulatory}) picked up on the plan prose are a weaker signal.
    const nameTokens = tokenize(frontmatter.name || "");
    const nameHits = nameTokens.filter((t) => planKeywords.has(t));
    if (nameHits.length > 0) {
      score += nameHits.length;
      reasons.push(`${nameHits.length} name match(es)`);
    }

    if (frontmatter.domain && tagMatches(frontmatter.domain, planKeywords)) {
      score += 2;
      reasons.push("domain match");
    }

    if (score > 0) {
      matched.push({ ...sketch, score, reason: reasons.join("; ") });
    }
  }

  matched.sort((a, b) => b.score - a.score);
  return matched;
}

/**
 * Format a matched sketch as a markdown system-prompt fragment.
 */
export function renderSketchForPrompt(sketch: MatchedSketch): string {
  const lines: string[] = [];
  lines.push(`## Analysis Sketch: ${sketch.frontmatter.name}`);
  lines.push(`*(matched via ${sketch.reason})*`);
  lines.push("");

  if (sketch.frontmatter.description) {
    lines.push(sketch.frontmatter.description);
    lines.push("");
  }

  const assertions = (sketch.frontmatter.expected_output || [])
    .flatMap((eo) => eo.assertions || [])
    .filter(Boolean);
  if (assertions.length > 0) {
    lines.push("**Expected outputs (ground-truth checks):**");
    for (const a of assertions) {
      lines.push(`- ${a}`);
    }
    lines.push("");
    lines.push(
      "Call `analysis_assertions_from_sketch` once the relevant step is on the plan " +
      "to pre-populate these as pending drafts. Each later `analysis_assert` call " +
      "with matching claim text will fill the draft in place with a real verdict.",
    );
    lines.push("");
  }

  lines.push(sketch.body);
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function* walkForSketchFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkForSketchFiles(full);
    } else if (ent.isFile() && (ent.name === "SKETCH.md" || ent.name.endsWith(".sketch.md"))) {
      yield full;
    }
  }
}

/**
 * Parse the YAML frontmatter block via the `yaml` library. Any parse or
 * schema failure returns null so malformed sketches skip cleanly.
 */
function parseYamlFrontmatter(src: string): SketchFrontmatter | null {
  try {
    const parsed = parseYaml(src) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const fm = parsed as SketchFrontmatter;
    if (!fm.name || typeof fm.name !== "string") return null;
    return fm;
  } catch {
    return null;
  }
}

/**
 * Short tool name for matcher: "toolshed.../repos/iuc/hisat2/hisat2/2.2.1" -> "hisat2"
 */
function shortToolName(toolId: string): string {
  const parts = toolId.split("/");
  if (parts.length >= 2) return parts[parts.length - 2];
  return toolId;
}

/**
 * First underscore-separated segment of a tool's short name. Returns the empty
 * string (interpreted as "no usable prefix") for segments under 5 characters,
 * to keep noise words like "report_" or "run_" from producing false family
 * matches.
 */
function toolPrefix(shortName: string): string {
  const segment = shortName.toLowerCase().split("_")[0];
  return segment.length >= 5 ? segment : "";
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "their",
  "a", "an", "of", "in", "on", "to", "by", "is", "are", "be",
  "analysis", "analyses", "data", "tool", "tools", "step", "steps",
  "run", "use", "using", "plan", "workflow", "galaxy",
  "study", "case", "set", "sets",
]);

function tokenize(text: string): string[] {
  // Unicode-aware: split on anything that isn't a letter or number in any
  // script, so "RNA-seq" tokenizes as ["rna", "seq"] and non-ASCII sketch
  // metadata (organism names, etc.) survives.
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Match a sketch tag/domain against the plan keyword bag. Tries the whole
 * lowercased string first (so `single-cell` can match literal `single-cell`
 * in a plan that hand-wrote the hyphen), then falls back to any token from
 * the tag matching a keyword (so `rna-seq` still matches a plan that typed
 * "RNA seq" or "RNA Seq analysis").
 */
function tagMatches(tagOrDomain: string, keywords: Set<string>): boolean {
  const lower = tagOrDomain.toLowerCase();
  if (keywords.has(lower)) return true;
  const tokens = tokenize(tagOrDomain);
  return tokens.some((t) => keywords.has(t));
}

/**
 * Bag of distinctive keywords from everything the researcher has typed about
 * the plan. Used so a sketch's tags/name/domain can match even before any
 * tool steps land on the plan.
 */
function extractPlanKeywords(plan: AnalysisPlan): Set<string> {
  const sources: string[] = [
    plan.title,
    plan.context.researchQuestion,
    plan.context.dataDescription,
    ...plan.context.expectedOutcomes,
    ...plan.context.constraints,
  ];
  for (const step of plan.steps) {
    sources.push(step.name, step.description);
  }
  if (plan.researchQuestion?.hypothesis) {
    sources.push(plan.researchQuestion.hypothesis);
  }
  if (plan.brcContext?.analysisCategory) {
    sources.push(plan.brcContext.analysisCategory);
  }
  return new Set(tokenize(sources.filter(Boolean).join(" ")));
}
