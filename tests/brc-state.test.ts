import { describe, it, expect, beforeEach } from "vitest";
import {
  createPlan,
  getCurrentPlan,
  resetState,
  setBRCOrganism,
  setBRCAssembly,
  setBRCWorkflow,
  getBRCContext,
} from "../extensions/galaxy-analyst/state";

describe("BRC context state functions", () => {
  beforeEach(() => {
    resetState();
  });

  describe("setBRCOrganism", () => {
    it("sets organism on plan", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      setBRCOrganism({ species: "Saccharomyces cerevisiae", taxonomyId: "559292", commonName: "Baker's yeast" });

      const plan = getCurrentPlan()!;
      expect(plan.brcContext).toBeTruthy();
      expect(plan.brcContext!.organism!.species).toBe("Saccharomyces cerevisiae");
      expect(plan.brcContext!.organism!.taxonomyId).toBe("559292");
      expect(plan.brcContext!.organism!.commonName).toBe("Baker's yeast");
    });

    it("throws without active plan", () => {
      expect(() => setBRCOrganism({ species: "Yeast", taxonomyId: "559292" })).toThrow("No active plan");
    });

    it("initializes brcContext if not set", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      expect(getCurrentPlan()!.brcContext).toBeUndefined();

      setBRCOrganism({ species: "Yeast", taxonomyId: "559292" });
      expect(getCurrentPlan()!.brcContext).toBeTruthy();
    });
  });

  describe("setBRCAssembly", () => {
    it("sets assembly on plan", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      setBRCAssembly({
        accession: "GCF_000146045.2",
        species: "Saccharomyces cerevisiae",
        isReference: true,
        hasGeneAnnotation: true,
        geneModelUrl: "https://example.com/genes.gff3",
      });

      const ctx = getCurrentPlan()!.brcContext!;
      expect(ctx.assembly!.accession).toBe("GCF_000146045.2");
      expect(ctx.assembly!.isReference).toBe(true);
      expect(ctx.assembly!.hasGeneAnnotation).toBe(true);
      expect(ctx.assembly!.geneModelUrl).toBe("https://example.com/genes.gff3");
    });

    it("throws without active plan", () => {
      expect(() => setBRCAssembly({
        accession: "GCF_000146045.2",
        species: "Yeast",
        isReference: true,
        hasGeneAnnotation: true,
      })).toThrow("No active plan");
    });
  });

  describe("setBRCWorkflow", () => {
    it("sets category, iwcId, and name", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      setBRCWorkflow({
        category: "TRANSCRIPTOMICS",
        iwcId: "rnaseq-pe-main",
        name: "RNA-Seq Analysis: Paired-End Read Processing",
      });

      const ctx = getCurrentPlan()!.brcContext!;
      expect(ctx.analysisCategory).toBe("TRANSCRIPTOMICS");
      expect(ctx.workflowIwcId).toBe("rnaseq-pe-main");
      expect(ctx.workflowName).toBe("RNA-Seq Analysis: Paired-End Read Processing");
    });

    it("throws without active plan", () => {
      expect(() => setBRCWorkflow({
        category: "TRANSCRIPTOMICS",
        iwcId: "rnaseq-pe-main",
        name: "RNA-seq PE",
      })).toThrow("No active plan");
    });
  });

  describe("getBRCContext", () => {
    it("returns null without plan", () => {
      expect(getBRCContext()).toBeNull();
    });

    it("returns null when no context set", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      expect(getBRCContext()).toBeNull();
    });

    it("returns context when set", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });
      setBRCOrganism({ species: "Yeast", taxonomyId: "559292" });

      const ctx = getBRCContext();
      expect(ctx).toBeTruthy();
      expect(ctx!.organism!.species).toBe("Yeast");
    });
  });

  describe("incremental updates", () => {
    it("preserves existing fields when setting new ones", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      setBRCOrganism({ species: "Saccharomyces cerevisiae", taxonomyId: "559292" });
      setBRCAssembly({
        accession: "GCF_000146045.2",
        species: "Saccharomyces cerevisiae",
        isReference: true,
        hasGeneAnnotation: true,
      });

      const ctx = getBRCContext()!;
      expect(ctx.organism!.species).toBe("Saccharomyces cerevisiae");
      expect(ctx.assembly!.accession).toBe("GCF_000146045.2");
    });

    it("preserves organism and assembly when setting workflow", () => {
      createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

      setBRCOrganism({ species: "Yeast", taxonomyId: "559292" });
      setBRCAssembly({
        accession: "GCF_000146045.2",
        species: "Yeast",
        isReference: true,
        hasGeneAnnotation: true,
      });
      setBRCWorkflow({
        category: "TRANSCRIPTOMICS",
        iwcId: "rnaseq-pe-main",
        name: "RNA-seq PE",
      });

      const ctx = getBRCContext()!;
      expect(ctx.organism!.taxonomyId).toBe("559292");
      expect(ctx.assembly!.accession).toBe("GCF_000146045.2");
      expect(ctx.workflowIwcId).toBe("rnaseq-pe-main");
    });
  });
});
