import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadSketchCorpus,
  parseSketch,
  matchSketchesForPlan,
  renderSketchForPrompt,
} from "../extensions/loom/sketches";
import {
  createPlan,
  resetState,
  addStep,
  getCurrentPlan,
} from "../extensions/loom/state";

function makeCorpus(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-sketches-"));
  const sketchesRoot = path.join(root, "sketches");
  fs.mkdirSync(sketchesRoot, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(sketchesRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return root;
}

const ALPHAGENOME_SKETCH = `---
name: alphagenome-gwas-regulatory
description: AlphaGenome GWAS regulatory interpretation
domain: variant-calling
tags:
  - alphagenome
  - gwas
  - regulatory
tools:
  - name: alphagenome_ism_scanner
    version: 0.6.1+galaxy0
  - name: alphagenome_variant_scorer
    version: 0.6.1+galaxy0
source:
  ecosystem: iwc
  workflow: 417e33144b294c21
expected_output:
  - role: ranked_positions_ism
    assertions:
      - Top ISM position scored above 3.0 for validated loci
      - Peak co-localizes with lead SNP within 500bp
---

# Body

Run ISM scanner, then rank variants.
`;

const UNRELATED_SKETCH = `---
name: rna-seq-deseq2
tags:
  - rna-seq
  - deseq2
tools:
  - name: deseq2
---

Body text.
`;

const MALFORMED_SKETCH = `---
not valid frontmatter at all
---

Body.
`;

describe("sketch parsing", () => {
  it("extracts frontmatter and body from a valid SKETCH.md", () => {
    const parsed = parseSketch(ALPHAGENOME_SKETCH);
    expect(parsed).toBeTruthy();
    expect(parsed!.frontmatter.name).toBe("alphagenome-gwas-regulatory");
    expect(parsed!.frontmatter.tags).toContain("alphagenome");
    expect(parsed!.frontmatter.tools?.[0].name).toBe("alphagenome_ism_scanner");
    expect(parsed!.frontmatter.source?.workflow).toBe("417e33144b294c21");
    expect(parsed!.frontmatter.expected_output?.[0].assertions).toHaveLength(2);
    expect(parsed!.body).toContain("Run ISM scanner");
  });

  it("returns null for malformed frontmatter", () => {
    expect(parseSketch(MALFORMED_SKETCH)).toBeNull();
    expect(parseSketch("no frontmatter here")).toBeNull();
  });
});

describe("sketch corpus loading", () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("loads multiple sketches from a corpus directory", () => {
    root = makeCorpus({
      "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH,
      "rna-seq/SKETCH.md": UNRELATED_SKETCH,
    });

    const loaded = loadSketchCorpus(root);
    const names = loaded.map((s) => s.frontmatter.name).sort();
    expect(names).toEqual(["alphagenome-gwas-regulatory", "rna-seq-deseq2"]);
  });

  it("skips malformed sketches without crashing", () => {
    root = makeCorpus({
      "good/SKETCH.md": ALPHAGENOME_SKETCH,
      "broken/SKETCH.md": MALFORMED_SKETCH,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loaded = loadSketchCorpus(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].frontmatter.name).toBe("alphagenome-gwas-regulatory");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns an empty array for missing corpus path", () => {
    expect(loadSketchCorpus("/nonexistent/path")).toEqual([]);
    expect(loadSketchCorpus("")).toEqual([]);
  });
});

describe("sketch matching against a plan", () => {
  beforeEach(() => {
    resetState();
  });

  it("matches on tool id overlap for an alphagenome plan", () => {
    createPlan({
      title: "AG Plan",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    addStep({
      name: "ISM",
      description: "ISM scan",
      executionType: "tool",
      toolId: "alphagenome_ism_scanner",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!, parseSketch(UNRELATED_SKETCH)!].map(
      (s, i) => ({ ...s, filePath: `/tmp/${i}/SKETCH.md` }),
    );

    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    expect(matches).toHaveLength(1);
    expect(matches[0].frontmatter.name).toBe("alphagenome-gwas-regulatory");
    expect(matches[0].reason).toContain("tool match");
  });

  it("returns an empty array when no signal matches", () => {
    createPlan({
      title: "Unrelated",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    addStep({
      name: "Something else entirely",
      description: "",
      executionType: "tool",
      toolId: "completely-unrelated-tool",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!].map((s, i) => ({
      ...s,
      filePath: `/tmp/${i}/SKETCH.md`,
    }));

    expect(matchSketchesForPlan(getCurrentPlan()!, corpus)).toEqual([]);
  });

  it("ranks exact workflow id match above tool-id overlap", () => {
    const exact = parseSketch(ALPHAGENOME_SKETCH)!;
    const toolOnly = parseSketch(
      ALPHAGENOME_SKETCH.replace("417e33144b294c21", "other-workflow-id"),
    )!;
    toolOnly.frontmatter.name = "alphagenome-variant";

    createPlan({
      title: "AG Workflow",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    // Add a workflow step with matching workflow ID
    addStep({
      name: "AG Workflow",
      description: "",
      executionType: "workflow",
      workflowId: "417e33144b294c21",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });

    const corpus = [
      { ...toolOnly, filePath: "/tmp/a/SKETCH.md" },
      { ...exact, filePath: "/tmp/b/SKETCH.md" },
    ];
    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);

    expect(matches[0].frontmatter.name).toBe("alphagenome-gwas-regulatory");
    expect(matches[0].reason).toContain("exact workflow match");
  });

  it("matches on plan-text keywords against sketch tags (no tools yet)", () => {
    createPlan({
      title: "Regulatory GWAS variant analysis",
      researchQuestion: "Which variants in a credible set drive regulatory effects?",
      dataDescription: "GWAS summary stats for a single locus",
      expectedOutcomes: [],
      constraints: [],
    });
    // Note: no steps added -- sketch must match on prose alone.

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!].map((s, i) => ({
      ...s,
      filePath: `/tmp/${i}/SKETCH.md`,
    }));

    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toMatch(/tag match|name match/);
  });

  it("matches on sketch name tokens appearing in plan prose", () => {
    createPlan({
      title: "Using AlphaGenome to interpret a credible set",
      researchQuestion: "What is the causal variant?",
      dataDescription: "Summary stats",
      expectedOutcomes: [],
      constraints: [],
    });

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!].map((s, i) => ({
      ...s,
      filePath: `/tmp/${i}/SKETCH.md`,
    }));

    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    expect(matches).toHaveLength(1);
    // 'alphagenome' appears as both a sketch tag and a name token in the plan prose.
    expect(matches[0].score).toBeGreaterThan(0);
  });

  it("matches on tool-family prefix (same `alphagenome_*` namespace)", () => {
    createPlan({
      title: "Interval prediction",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    // Plan uses an alphagenome_ tool the sketch does NOT list directly,
    // so exact short-name matching should miss and family matching kicks in.
    addStep({
      name: "Predict",
      description: "Interval prediction",
      executionType: "tool",
      toolId: "alphagenome_interval_predictor",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!].map((s, i) => ({
      ...s,
      filePath: `/tmp/${i}/SKETCH.md`,
    }));

    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toContain("tool-family match");
    // Family hit should carry less weight than an exact tool hit.
    expect(matches[0].reason).not.toContain("1 tool match");
  });

  it("gives full tool hits priority over family prefix hits", () => {
    createPlan({
      title: "ISM",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    addStep({
      name: "ISM",
      description: "",
      executionType: "tool",
      toolId: "alphagenome_ism_scanner",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!].map((s, i) => ({
      ...s,
      filePath: `/tmp/${i}/SKETCH.md`,
    }));

    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    // Exact tool hit (10 pts) should land, prefix hit for the same tool should not double-count.
    expect(matches[0].reason).toContain("tool match");
    expect(matches[0].reason).not.toContain("tool-family match");
  });

  it("does not match on stop words alone", () => {
    createPlan({
      title: "Analysis plan for data workflow",
      researchQuestion: "Run the tool on the data",
      dataDescription: "Some data",
      expectedOutcomes: [],
      constraints: [],
    });

    const corpus = [parseSketch(ALPHAGENOME_SKETCH)!].map((s, i) => ({
      ...s,
      filePath: `/tmp/${i}/SKETCH.md`,
    }));

    // Every token in the plan is a stop word -- shouldn't match anything.
    expect(matchSketchesForPlan(getCurrentPlan()!, corpus)).toEqual([]);
  });

  it("matches hyphenated sketch tags against plan prose with or without the hyphen", () => {
    const RNA_SEQ_SKETCH = parseSketch(
      `---
name: bulk-rnaseq
tags:
  - rna-seq
  - deseq2
expected_output:
  - assertions:
      - DE gene count within tolerance
---

Body.
`,
    )!;

    createPlan({
      title: "RNA Seq Pasilla analysis",
      researchQuestion: "Differential expression between treated and untreated",
      dataDescription: "Paired-end RNA seq reads",
      expectedOutcomes: [],
      constraints: [],
    });

    const corpus = [{ ...RNA_SEQ_SKETCH, filePath: "/tmp/rna/SKETCH.md" }];
    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    expect(matches).toHaveLength(1);
    expect(matches[0].reason).toContain("tag match");
  });

  it("tokenizes non-ASCII plan prose and sketch names", () => {
    const UNICODE_SKETCH = parseSketch(
      `---
name: mycobactérium-pipeline
tags:
  - mycobactérium
expected_output:
  - assertions:
      - Lineage call agrees with TB-Profiler
---

Body.
`,
    )!;

    createPlan({
      title: "Mycobactérium tuberculosis variant calling",
      researchQuestion: "Identify resistance mutations in Mycobactérium samples",
      dataDescription: "Short-read sequencing",
      expectedOutcomes: [],
      constraints: [],
    });

    const corpus = [{ ...UNICODE_SKETCH, filePath: "/tmp/u/SKETCH.md" }];
    const matches = matchSketchesForPlan(getCurrentPlan()!, corpus);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does not match on short shared tool-id prefixes (below length threshold)", () => {
    // Concoct a corpus entry whose tool prefix is too short to be distinctive.
    const SHORT_PREFIX_SKETCH = parseSketch(
      `---
name: short-prefix
tags:
  - other
tools:
  - name: run_this
  - name: run_that
expected_output:
  - assertions:
      - Claim
---

Body.
`,
    )!;

    createPlan({
      title: "Another plan",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    addStep({
      name: "Run",
      description: "",
      executionType: "tool",
      toolId: "run_something_else",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });

    const corpus = [{ ...SHORT_PREFIX_SKETCH, filePath: "/tmp/short/SKETCH.md" }];
    // "run" is 3 chars -- prefix threshold is >= 5, so no family match.
    expect(matchSketchesForPlan(getCurrentPlan()!, corpus)).toEqual([]);
  });
});

describe("renderSketchForPrompt", () => {
  it("includes name, matched-reason, assertions, and body", () => {
    const parsed = parseSketch(ALPHAGENOME_SKETCH)!;
    const rendered = renderSketchForPrompt({
      ...parsed,
      filePath: "/tmp/SKETCH.md",
      score: 20,
      reason: "2 tool match(es)",
    });

    expect(rendered).toContain("## Analysis Sketch: alphagenome-gwas-regulatory");
    expect(rendered).toContain("2 tool match(es)");
    expect(rendered).toContain("Top ISM position scored above 3.0");
    expect(rendered).toContain("Run ISM scanner");
  });

  it("tells the agent how to pre-populate drafts when the sketch has assertions", () => {
    const parsed = parseSketch(ALPHAGENOME_SKETCH)!;
    const rendered = renderSketchForPrompt({
      ...parsed,
      filePath: "/tmp/SKETCH.md",
      score: 20,
      reason: "2 tool match(es)",
    });

    expect(rendered).toContain("analysis_assertions_from_sketch");
    expect(rendered).toContain("analysis_assert");
  });
});
