import { describe, it, expect, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import galaxyAnalystExtension from "../extensions/galaxy-analyst/index";
import { resetState, getCurrentPlan, createPlan } from "../extensions/galaxy-analyst/state";

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: Function;
}

function createFakeAPI() {
  const tools = new Map<string, RegisteredTool>();
  const api: ExtensionAPI = {
    on() {},
    registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
    registerCommand() {},
    registerShortcut() {},
    appendEntry() {},
    sendMessage() {},
    sendUserMessage() {},
    events: { on() {}, emit() {} },
    getActiveTools() { return []; },
    getAllTools() { return []; },
    setActiveTools() {},
    registerFlag() {},
    registerProvider() {},
  } as unknown as ExtensionAPI;
  return { api, tools };
}

async function execTool(tools: Map<string, RegisteredTool>, name: string, params: Record<string, unknown>) {
  const tool = tools.get(name)!;
  const result = await tool.execute("call", params, undefined, undefined, {} as any);
  return JSON.parse((result.content[0] as { text: string }).text);
}

describe("brc_set_context tool", () => {
  let tools: Map<string, RegisteredTool>;

  beforeEach(() => {
    resetState();
    const fake = createFakeAPI();
    galaxyAnalystExtension(fake.api);
    tools = fake.tools;
  });

  it("returns error without active plan", async () => {
    const result = await execTool(tools, "brc_set_context", {
      organism: { species: "Yeast", taxonomyId: "559292" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No active plan");
  });

  it("returns error when no fields provided", async () => {
    createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

    const result = await execTool(tools, "brc_set_context", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("At least one");
  });

  it("sets organism only", async () => {
    createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

    const result = await execTool(tools, "brc_set_context", {
      organism: { species: "Saccharomyces cerevisiae", taxonomyId: "559292", commonName: "Baker's yeast" },
    });

    expect(result.success).toBe(true);
    expect(result.brcContext.organism.species).toBe("Saccharomyces cerevisiae");
    expect(result.brcContext.organism.taxonomyId).toBe("559292");
    expect(result.brcContext.assembly).toBeUndefined();
  });

  it("sets assembly only", async () => {
    createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

    const result = await execTool(tools, "brc_set_context", {
      assembly: {
        accession: "GCF_000146045.2",
        species: "Saccharomyces cerevisiae",
        isReference: true,
        hasGeneAnnotation: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.brcContext.assembly.accession).toBe("GCF_000146045.2");
    expect(result.brcContext.assembly.isReference).toBe(true);
  });

  it("sets all fields at once", async () => {
    createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

    const result = await execTool(tools, "brc_set_context", {
      organism: { species: "Saccharomyces cerevisiae", taxonomyId: "559292" },
      assembly: {
        accession: "GCF_000146045.2",
        species: "Saccharomyces cerevisiae",
        isReference: true,
        hasGeneAnnotation: true,
      },
      workflow: {
        category: "TRANSCRIPTOMICS",
        iwcId: "rnaseq-pe-main",
        name: "RNA-Seq PE",
      },
    });

    expect(result.success).toBe(true);
    expect(result.brcContext.organism.species).toBe("Saccharomyces cerevisiae");
    expect(result.brcContext.assembly.accession).toBe("GCF_000146045.2");
    expect(result.brcContext.analysisCategory).toBe("TRANSCRIPTOMICS");
    expect(result.brcContext.workflowIwcId).toBe("rnaseq-pe-main");
    expect(result.brcContext.workflowName).toBe("RNA-Seq PE");
  });

  it("returns current context after update", async () => {
    createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

    const result = await execTool(tools, "brc_set_context", {
      organism: { species: "Yeast", taxonomyId: "559292" },
    });

    expect(result.brcContext).toBeTruthy();
    expect(result.brcContext.organism.species).toBe("Yeast");
  });

  it("accumulates context across incremental calls", async () => {
    createPlan({ title: "Test", researchQuestion: "Q", dataDescription: "D", expectedOutcomes: [], constraints: [] });

    await execTool(tools, "brc_set_context", {
      organism: { species: "Saccharomyces cerevisiae", taxonomyId: "559292" },
    });

    const result = await execTool(tools, "brc_set_context", {
      workflow: {
        category: "TRANSCRIPTOMICS",
        iwcId: "rnaseq-pe-main",
        name: "RNA-Seq PE",
      },
    });

    expect(result.brcContext.organism.species).toBe("Saccharomyces cerevisiae");
    expect(result.brcContext.workflowIwcId).toBe("rnaseq-pe-main");
  });
});
