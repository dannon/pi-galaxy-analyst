import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createPlan,
  resetState,
  addStep,
  draftAssertionFromSketch,
  seedAssertionsFromSketchCorpus,
  recordAssertion,
  getCurrentPlan,
  setNotebookPath,
  syncToNotebook,
} from "../extensions/loom/state";
import { generateNotebook, writeNotebook, getDefaultNotebookPath } from "../extensions/loom/notebook-writer";
import { parseNotebook, notebookToPlan } from "../extensions/loom/notebook-parser";

/**
 * Sprint 3c.1 -- when a plan matches a sketch, pre-populate `analysis_assert`
 * entries (as drafts) from the sketch's expected_output[].assertions[] strings.
 * The analyst then fills in observed values; verdicts remain "pending" until
 * both expected and observed are provided.
 */

const ALPHAGENOME_SKETCH = `---
name: alphagenome-gwas-regulatory
tags:
  - alphagenome
tools:
  - name: alphagenome_ism_scanner
    version: 0.6.1+galaxy0
expected_output:
  - role: ranked_positions_ism
    assertions:
      - Top ISM position scored above 3.0 for validated loci
      - Peak co-localizes with lead SNP within 500bp
  - role: credible_set
    assertions:
      - Credible set has 18 variants at cumulative PP >= 0.95
---

# Body

Run ISM scanner, then rank variants.
`;

const UNRELATED_SKETCH = `---
name: rna-seq-deseq2
tags:
  - rna-seq
tools:
  - name: deseq2
expected_output:
  - assertions:
      - DE gene count within 10% of published
---

Body.
`;

function makeCorpus(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-sketch-seed-"));
  const sketchesRoot = path.join(root, "sketches");
  fs.mkdirSync(sketchesRoot, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(sketchesRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  return root;
}

function makeAlphaGenomePlan() {
  createPlan({
    title: "Malaria chr6",
    researchQuestion: "Find causal regulatory variant",
    dataDescription: "GWAS summary stats",
    expectedOutcomes: ["causal variant"],
    constraints: [],
  });
  addStep({
    name: "ISM scan",
    description: "Run ISM scanner",
    executionType: "tool",
    toolId: "toolshed.g2.bx.psu.edu/repos/iuc/alphagenome_ism_scanner/alphagenome_ism_scanner/0.6.1+galaxy0",
    inputs: [],
    expectedOutputs: [],
    dependsOn: [],
  });
}

describe("draftAssertionFromSketch", () => {
  beforeEach(() => {
    resetState();
  });

  it("creates a pending-verdict assertion from a prose claim", () => {
    makeAlphaGenomePlan();

    const a = draftAssertionFromSketch({
      claim: "Top ISM position scored above 3.0 for validated loci",
      source: "sketch:alphagenome-gwas-regulatory",
    });

    expect(a.verdict).toBe("pending");
    expect(a.kind).toBe("categorical");
    expect(a.claim).toBe("Top ISM position scored above 3.0 for validated loci");
    expect(a.source).toBe("sketch:alphagenome-gwas-regulatory");
    expect(a.expected).toBe("");
    expect(a.observed).toBe("");
  });

  it("threads stepId when provided", () => {
    makeAlphaGenomePlan();
    const stepId = getCurrentPlan()!.steps[0].id;

    const a = draftAssertionFromSketch({
      claim: "Peak co-localizes with lead SNP",
      source: "sketch:alphagenome-gwas-regulatory",
      stepId,
    });

    expect(a.stepId).toBe(stepId);
  });

  it("appends to the plan's assertion list", () => {
    makeAlphaGenomePlan();

    draftAssertionFromSketch({ claim: "A", source: "sketch:x" });
    draftAssertionFromSketch({ claim: "B", source: "sketch:x" });

    expect(getCurrentPlan()!.assertions).toHaveLength(2);
  });

  it("throws when no plan is active", () => {
    expect(() =>
      draftAssertionFromSketch({ claim: "nope", source: "sketch:x" }),
    ).toThrow(/No active plan/);
  });
});

describe("seedAssertionsFromSketchCorpus", () => {
  let root: string;

  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("seeds drafts from every expected_output assertion of every matching sketch", () => {
    makeAlphaGenomePlan();
    root = makeCorpus({
      "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH,
      "rna-seq/SKETCH.md": UNRELATED_SKETCH,
    });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });

    // Three assertions on the alphagenome sketch, zero match on rna-seq.
    expect(result.added).toBe(3);
    expect(result.skipped).toBe(0);
    const claims = getCurrentPlan()!.assertions!.map((a) => a.claim);
    expect(claims).toContain("Top ISM position scored above 3.0 for validated loci");
    expect(claims).toContain("Peak co-localizes with lead SNP within 500bp");
    expect(claims).toContain("Credible set has 18 variants at cumulative PP >= 0.95");
  });

  it("dedupes against existing assertion claims (case-insensitive)", () => {
    makeAlphaGenomePlan();
    recordAssertion({
      claim: "top ism position scored above 3.0 for validated loci",
      kind: "categorical",
      expected: "true",
      observed: "true",
      source: "manual",
    });
    root = makeCorpus({
      "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH,
    });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });

    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(getCurrentPlan()!.assertions).toHaveLength(3); // 1 pre-existing + 2 new
  });

  it("threads stepId to every seeded assertion when provided", () => {
    makeAlphaGenomePlan();
    const stepId = getCurrentPlan()!.steps[0].id;
    root = makeCorpus({ "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root, stepId });

    expect(result.added).toBe(3);
    for (const a of getCurrentPlan()!.assertions!) {
      expect(a.stepId).toBe(stepId);
    }
  });

  it("no-ops when no sketches match the plan", () => {
    makeAlphaGenomePlan();
    root = makeCorpus({ "rna-seq/SKETCH.md": UNRELATED_SKETCH });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(0);
    expect(getCurrentPlan()!.assertions ?? []).toHaveLength(0);
  });

  it("no-ops for a missing corpus path (no crash)", () => {
    makeAlphaGenomePlan();

    const result = seedAssertionsFromSketchCorpus({ corpusPath: "/does/not/exist" });

    expect(result.added).toBe(0);
  });

  it("tags source on each seeded assertion so it's traceable back to the sketch", () => {
    makeAlphaGenomePlan();
    root = makeCorpus({ "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH });

    seedAssertionsFromSketchCorpus({ corpusPath: root });

    for (const a of getCurrentPlan()!.assertions!) {
      expect(a.source).toBe("sketch:alphagenome-gwas-regulatory");
    }
  });

  it("collapses duplicate claims when two matching sketches share a claim", () => {
    makeAlphaGenomePlan();
    const SECOND_SKETCH = `---
name: alphagenome-companion
tags:
  - alphagenome
tools:
  - name: alphagenome_ism_scanner
expected_output:
  - assertions:
      - Top ISM position scored above 3.0 for validated loci
      - A claim only this sketch contributes
---

Body.
`;
    root = makeCorpus({
      "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH,
      "companion/SKETCH.md": SECOND_SKETCH,
    });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });

    // 3 unique from the first sketch + 1 unique from the second, 1 duplicate skipped.
    expect(result.added).toBe(4);
    expect(result.skipped).toBe(1);
    const topIsmClaims = getCurrentPlan()!.assertions!.filter((a) =>
      a.claim.startsWith("Top ISM position"),
    );
    expect(topIsmClaims).toHaveLength(1);
  });

  it("tolerates a malformed expected_output on one sketch without aborting the corpus", () => {
    const MALFORMED_EXPECTED = `---
name: alphagenome-broken
tags:
  - alphagenome
tools:
  - name: alphagenome_ism_scanner
expected_output:
  not_an_array: true
---

Body.
`;
    makeAlphaGenomePlan();
    root = makeCorpus({
      "broken/SKETCH.md": MALFORMED_EXPECTED,
      "good/SKETCH.md": ALPHAGENOME_SKETCH,
    });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });

    // Broken sketch contributes 0 claims, good sketch still contributes 3.
    expect(result.added).toBe(3);
  });

  it("tolerates non-string assertion entries within expected_output", () => {
    const MIXED_ASSERTIONS = `---
name: alphagenome-mixed
tags:
  - alphagenome
tools:
  - name: alphagenome_ism_scanner
expected_output:
  - assertions:
      - A valid claim
      - 42
      - null
      - Another valid claim
---

Body.
`;
    makeAlphaGenomePlan();
    root = makeCorpus({ "mixed/SKETCH.md": MIXED_ASSERTIONS });

    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });

    expect(result.added).toBe(2);
    const claims = getCurrentPlan()!.assertions!.map((a) => a.claim);
    expect(claims).toContain("A valid claim");
    expect(claims).toContain("Another valid claim");
  });
});

describe("analysis_assert upgrades a seeded draft instead of duplicating it", () => {
  let root: string;

  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("updates the draft in place when the same claim is later recorded", () => {
    makeAlphaGenomePlan();
    root = makeCorpus({ "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH });
    seedAssertionsFromSketchCorpus({ corpusPath: root });

    const draftCount = getCurrentPlan()!.assertions!.length;
    const draft = getCurrentPlan()!.assertions!.find((a) =>
      a.claim.startsWith("Top ISM position"),
    )!;
    expect(draft.verdict).toBe("pending");
    const draftId = draft.id;

    const finalized = recordAssertion({
      claim: "Top ISM position scored above 3.0 for validated loci",
      kind: "categorical",
      expected: "above-3",
      observed: "above-3",
    });

    // Same row, not an appended duplicate.
    expect(getCurrentPlan()!.assertions).toHaveLength(draftCount);
    expect(finalized.id).toBe(draftId);
    expect(finalized.verdict).toBe("exact_match");
  });

  it("preserves the draft's stepId when the update doesn't override it", () => {
    makeAlphaGenomePlan();
    const stepId = getCurrentPlan()!.steps[0].id;
    root = makeCorpus({ "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH });
    seedAssertionsFromSketchCorpus({ corpusPath: root, stepId });

    const finalized = recordAssertion({
      claim: "Top ISM position scored above 3.0 for validated loci",
      kind: "categorical",
      expected: "x",
      observed: "x",
    });

    expect(finalized.stepId).toBe(stepId);
  });

  it("does not clobber a finalized assertion that happens to share claim text", () => {
    makeAlphaGenomePlan();
    const finalized = recordAssertion({
      claim: "Top ISM position scored above 3.0 for validated loci",
      kind: "categorical",
      expected: "exact",
      observed: "exact",
    });
    expect(finalized.verdict).toBe("exact_match");
    root = makeCorpus({ "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH });

    // Seeding the same claim finds the finalized row (not pending) and skips.
    const result = seedAssertionsFromSketchCorpus({ corpusPath: root });
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);

    // Now recording the same claim again should append (no pending draft to
    // upgrade, finalized row is untouched by the pending-only lookup).
    const again = recordAssertion({
      claim: "Top ISM position scored above 3.0 for validated loci",
      kind: "categorical",
      expected: "exact",
      observed: "exact",
    });
    expect(again.id).not.toBe(finalized.id);
    // Still only one pending draft in the finalized state -- the original
    // finalized row is preserved, no data loss.
    expect(
      getCurrentPlan()!.assertions!.filter(
        (a) => a.id === finalized.id,
      ),
    ).toHaveLength(1);
  });
});

describe("assertion_added sync path rewrites the verification section on disk", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetState();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-sync-"));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("regenerates the assertions block when syncToNotebook('assertion_added') runs", async () => {
    makeAlphaGenomePlan();
    const notebookPath = path.join(tmpDir, "plan.md");
    // Seed the file with an initial notebook (no assertions yet).
    await writeNotebook(notebookPath, generateNotebook(getCurrentPlan()!));
    setNotebookPath(notebookPath);

    // Verify the starting file has no assertions_json.
    expect(fs.readFileSync(notebookPath, "utf-8")).not.toContain("assertions_json");

    // Record a real assertion and trigger the sync path the tool uses.
    const stored = recordAssertion({
      claim: "Top ISM position is above threshold",
      kind: "categorical",
      expected: "true",
      observed: "true",
      source: "manual",
    });
    await syncToNotebook("assertion_added", {
      claim: stored.claim,
      verdict: stored.verdict,
      kind: stored.kind,
    });

    // The on-disk file now has the assertions_json block -- frontmatter-only
    // sync would never have touched it.
    const after = fs.readFileSync(notebookPath, "utf-8");
    expect(after).toContain("assertions_json");
    expect(after).toContain("Top ISM position is above threshold");
  });
});

describe("seeded drafts round-trip through notebook", () => {
  let root: string;

  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("pending drafts survive write -> parse cycle with verdict preserved", () => {
    makeAlphaGenomePlan();
    root = makeCorpus({ "alphagenome/SKETCH.md": ALPHAGENOME_SKETCH });
    seedAssertionsFromSketchCorpus({ corpusPath: root });

    const plan = getCurrentPlan()!;
    const notebook = generateNotebook(plan);
    const parsed = parseNotebook(notebook);
    expect(parsed).not.toBeNull();
    const restored = notebookToPlan(parsed!);

    expect(restored.assertions).toHaveLength(3);
    for (const a of restored.assertions!) {
      expect(a.verdict).toBe("pending");
      expect(a.source).toBe("sketch:alphagenome-gwas-regulatory");
    }
  });
});
