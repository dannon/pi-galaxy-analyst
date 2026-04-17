import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createPlan,
  resetState,
  addStep,
  recordAssertion,
  computeAssertionVerdict,
  resolveExpectedFromPlan,
  getCurrentPlan,
} from "../extensions/loom/state";
import { generateNotebook } from "../extensions/loom/notebook-writer";
import { parseNotebook, notebookToPlan } from "../extensions/loom/notebook-parser";

describe("computeAssertionVerdict", () => {
  it("scalar: within_tolerance when diff <= tolerance fraction of expected", () => {
    // 4.17 vs 4.169 with 5% tolerance → within_tolerance
    expect(computeAssertionVerdict("scalar", 4.17, 4.169, 0.05)).toBe("within_tolerance");
  });

  it("scalar: exact_match on identical floats", () => {
    expect(computeAssertionVerdict("scalar", 4.17, 4.17, 0.01)).toBe("exact_match");
  });

  it("scalar: drift when inside 2x tolerance but outside 1x", () => {
    // Expected 4.0, observed 4.25, tolerance 5% → allowed 0.2, diff 0.25 → drift
    expect(computeAssertionVerdict("scalar", 4.0, 4.25, 0.05)).toBe("drift");
  });

  it("scalar: mismatch when diff > 2x tolerance", () => {
    expect(computeAssertionVerdict("scalar", 4.0, 5.0, 0.05)).toBe("mismatch");
  });

  it("scalar: mismatch on non-numeric inputs", () => {
    expect(computeAssertionVerdict("scalar", "foo", "bar")).toBe("mismatch");
  });

  it("categorical: exact_match on string equality", () => {
    expect(computeAssertionVerdict("categorical", "rs334", "rs334")).toBe("exact_match");
  });

  it("categorical: mismatch on any inequality", () => {
    expect(computeAssertionVerdict("categorical", "rs334", "rs1050828")).toBe("mismatch");
  });

  it("rank: exact_match on same integer rank", () => {
    expect(computeAssertionVerdict("rank", 1, 1)).toBe("exact_match");
  });

  it("rank: within_tolerance when off by tolerance positions", () => {
    expect(computeAssertionVerdict("rank", 1, 3, 2)).toBe("within_tolerance");
  });

  it("rank: mismatch when outside tolerance", () => {
    expect(computeAssertionVerdict("rank", 1, 5, 2)).toBe("mismatch");
  });

  it("set_member: exact_match when observed is in the expected set", () => {
    expect(
      computeAssertionVerdict("set_member", ["rs334", "rs1050828", "rs2814778"], "rs334")
    ).toBe("exact_match");
  });

  it("set_member: mismatch when observed is not in the set", () => {
    expect(
      computeAssertionVerdict("set_member", ["rs334", "rs1050828"], "rs2814778")
    ).toBe("mismatch");
  });

  it("coord_range: within_range on coordinate inside interval", () => {
    expect(computeAssertionVerdict("coord_range", [92618200, 92618300], 92618245)).toBe(
      "within_range"
    );
  });

  it("coord_range: out_of_range on coordinate outside interval", () => {
    expect(computeAssertionVerdict("coord_range", [92618200, 92618300], 92650000)).toBe(
      "out_of_range"
    );
  });

  it("coord_range: mismatch on malformed expected", () => {
    expect(computeAssertionVerdict("coord_range", "not a range", 100)).toBe("mismatch");
  });

  it("count: exact_match on identical counts", () => {
    expect(computeAssertionVerdict("count", 15, 15)).toBe("exact_match");
  });

  it("count: within_tolerance and mismatch behave like rank", () => {
    expect(computeAssertionVerdict("count", 15, 18, 3)).toBe("within_tolerance");
    expect(computeAssertionVerdict("count", 15, 20, 3)).toBe("mismatch");
  });
});

describe("recordAssertion", () => {
  beforeEach(() => {
    resetState();
  });

  function seedPlan() {
    createPlan({
      title: "Assertion recording",
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
  }

  it("stores each kind on the plan with verdict computed", () => {
    seedPlan();
    const a1 = recordAssertion({
      stepId: "1",
      claim: "Top CHIP_TF score",
      kind: "scalar",
      expected: 4.17,
      observed: 4.169,
      tolerance: 0.05,
    });
    const a2 = recordAssertion({
      stepId: "1",
      claim: "Top variant",
      kind: "categorical",
      expected: "rs334",
      observed: "rs334",
    });

    expect(a1.verdict).toBe("within_tolerance");
    expect(a2.verdict).toBe("exact_match");
    expect(getCurrentPlan()!.assertions).toHaveLength(2);
    expect(a1.id).toBeTruthy();
    expect(a2.id).toBeTruthy();
    expect(a1.id).not.toBe(a2.id);
  });

  it("round-trips assertions through notebook write + parse", () => {
    seedPlan();
    recordAssertion({
      stepId: "1",
      claim: "Top CHIP_TF score 4.17 +/- 5%",
      kind: "scalar",
      expected: 4.17,
      observed: 4.169,
      tolerance: 0.05,
    });
    recordAssertion({
      stepId: "1",
      claim: "Lead SNP in credible set",
      kind: "set_member",
      expected: ["rs334", "rs1050828", "rs2814778"],
      observed: "rs334",
    });
    recordAssertion({
      claim: "Plan-level note: peak count",
      kind: "count",
      expected: 15,
      observed: 18,
      tolerance: 3,
    });

    const markdown = generateNotebook(getCurrentPlan()!);
    expect(markdown).toContain("## Verification");
    expect(markdown).toContain("| 1 | scalar | Top CHIP_TF");
    expect(markdown).toContain("`within_tolerance`");

    const parsed = parseNotebook(markdown);
    const restored = notebookToPlan(parsed!);

    expect(restored.assertions).toHaveLength(3);
    expect(restored.assertions![0]).toMatchObject({
      stepId: "1",
      kind: "scalar",
      expected: 4.17,
      observed: 4.169,
      verdict: "within_tolerance",
    });
    expect(restored.assertions![1]).toMatchObject({
      kind: "set_member",
      verdict: "exact_match",
    });
    expect(restored.assertions![1].expected).toEqual([
      "rs334",
      "rs1050828",
      "rs2814778",
    ]);
    expect(restored.assertions![2]).toMatchObject({
      kind: "count",
      verdict: "within_tolerance",
    });
    expect(restored.assertions![2].stepId).toBeFalsy();
  });
});

describe("expectedFromPlan cross-reference", () => {
  let tmpDir: string;

  beforeEach(() => {
    resetState();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-assert-"));
  });

  it("resolves an expected value from another plan's notebook on disk", async () => {
    // 1. Create a reference plan and write its notebook to the tmpDir.
    const ref = createPlan({
      title: "Reference run",
      researchQuestion: "Q",
      dataDescription: "D",
      expectedOutcomes: [],
      constraints: [],
    });
    addStep({
      name: "Prior ISM",
      description: "Baseline ISM peak",
      executionType: "tool",
      toolId: "alphagenome_ism_scanner",
      inputs: [],
      expectedOutputs: [],
      dependsOn: [],
    });
    // Manually set a summary on the step's result so we can cross-reference it.
    ref.steps[0].result = {
      completedAt: "2026-03-01T00:00:00Z",
      jobId: "job-ref",
      summary: "peak=4.17",
      qcPassed: true,
    };
    // Write the notebook to disk matching the naming convention the
    // listNotebooks helper uses.
    const refContent = generateNotebook(getCurrentPlan()!);
    const refPath = path.join(tmpDir, "reference-run-notebook.md");
    fs.writeFileSync(refPath, refContent);

    resetState();

    // 2. Resolve the field from the reference plan.
    const resolved = await resolveExpectedFromPlan({
      planId: ref.id,
      stepId: "1",
      field: "result.summary",
      searchDirectories: [tmpDir],
    });

    expect(resolved).toBe("peak=4.17");
  });
});
