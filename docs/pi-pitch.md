# Loom: AI-Assisted Bioinformatics with Full Reproducibility

## The Problem

Bioinformatics analyses are complex, multi-step workflows where:

- **Decisions get lost**: Why did we use HISAT2 instead of STAR? What parameters did we choose and why?
- **Sessions get interrupted**: Analysis spans days or weeks. Context is lost between sessions.
- **Reproducibility suffers**: Recreating an analysis months later requires detective work through Galaxy histories.
- **Onboarding is slow**: New lab members struggle to understand past analyses.

## The Solution

Loom is an AI co-scientist that:

1. **Structures every analysis** with a formal plan before execution
2. **Documents every decision** with rationale and researcher approval
3. **Creates persistent notebooks** that serve as both working state AND final documentation
4. **Enables seamless session resumption** - start Monday, continue Tuesday

---

## Sample Analysis Walkthrough

### Day 1: Starting the Analysis

```
$ pi  # Start the AI assistant

You: I want to analyze RNA-seq data from a Drosophila Pasilla
     knockdown experiment. 4 treated samples, 3 controls,
     paired-end Illumina. Goal is differential expression.

Pi: I'll create an analysis plan for this project.

    [Creates: ./rna-seq-pasilla-knockdown-notebook.md]

    Before we begin, let me confirm a few things:

    1. Research Question: Identify genes differentially expressed
       upon Pasilla depletion in Drosophila?
    2. Reference genome: dm6?
    3. Any specific DE thresholds (FDR, fold-change)?

You: Yes to all. FDR < 0.05, |log2FC| > 1

Pi: Perfect. Here's the analysis plan:

    1. [ ] Quality Control (FastQC + MultiQC)
    2. [ ] Read Trimming (Cutadapt) - if needed based on QC
    3. [ ] Read Mapping (HISAT2 to dm6)
    4. [ ] Quantification (featureCounts)
    5. [ ] Differential Expression (DESeq2)
    6. [ ] Functional Enrichment (gProfiler)

    Does this plan look correct? Should we proceed?

You: Looks good, let's start.

Pi: [Activates plan, begins Step 1]

    Starting Quality Control. I'll run FastQC on all 7 samples...

    [Runs FastQC via Galaxy MCP]
    [Logs decision: "Selected FastQC for initial QC - standard
     tool for Illumina data, comprehensive metrics"]

    QC complete. Results:
    - All samples: Q30 > 85%
    - Adapter content: Minor contamination detected (samples 2, 5)
    - Recommendation: Proceed with trimming step

    [Creates QC checkpoint: PASSED with observations]

You: Good, let's trim those adapters.

Pi: [Proceeds to Step 2...]
```

### Day 2: Resuming the Analysis

```
$ pi  # Same directory as yesterday

Pi: Loaded notebook: RNA-seq Pasilla Knockdown (2/6 steps completed)

    Last session completed:
    - [x] Quality Control - passed
    - [x] Read Trimming - completed

    Next step: Read Mapping with HISAT2

    Ready to continue?

You: Yes, run the mapping.

Pi: [Continues from exactly where we left off...]
```

---

## The Notebook: Your Analysis Record

The notebook file (`rna-seq-pasilla-knockdown-notebook.md`) is human-readable markdown:

```markdown
---
plan_id: "a1b2c3d4-..."
title: "RNA-seq Pasilla Knockdown"
status: active
created: "2024-01-15T10:30:00Z"
updated: "2024-01-16T14:22:00Z"

galaxy:
  server_url: "https://usegalaxy.org"
  history_id: "f597429621d6eb2b"
  history_name: "Pasilla RNA-seq Analysis"
---

# RNA-seq Pasilla Knockdown

## Research Context

**Research Question**: Identify genes differentially expressed upon
Pasilla depletion in Drosophila S2 cells

**Data Description**: 7 samples (4 treated, 3 control), paired-end
Illumina, ~20M reads per sample

**Expected Outcomes**: List of DE genes, GO enrichment, pathway analysis

---

## Analysis Plan

### Step 1: Quality Control

```yaml
step:
  id: "1"
  name: "Quality Control"
  status: completed
  execution:
    type: tool
    tool_id: "fastqc"
  outputs:
    - dataset_id: "abc123"
      name: "FastQC on Sample1"
    - dataset_id: "def456"
      name: "MultiQC Report"
  job_id: "job_789"
```

**Purpose**: Assess raw read quality before processing

### Step 2: Read Trimming
...

---

## Execution Log

### 2024-01-15 10:45 - Decision: tool_selection

```yaml
decision:
  timestamp: "2024-01-15T10:45:00Z"
  step_id: "1"
  type: tool_selection
  description: "Selected FastQC for initial quality assessment"
  rationale: "Standard tool for Illumina data, comprehensive metrics,
              widely used in the field"
  researcher_approved: true
```

### 2024-01-15 11:30 - QC Checkpoint

```yaml
checkpoint:
  id: "qc-1"
  step_id: "1"
  status: passed
  criteria:
    - "Per base quality > Q28"
    - "No critical warnings"
  observations:
    - "All samples pass basic quality metrics"
    - "Minor adapter contamination in samples 2, 5 - will trim"
```

---

## Galaxy References

| Resource | ID | URL |
|----------|-----|-----|
| History | f597429621d6eb2b | [View](https://usegalaxy.org/histories/view?id=f597429621d6eb2b) |
| FastQC Report | abc123 | [View](https://usegalaxy.org/datasets/abc123) |
| MultiQC Report | def456 | [View](https://usegalaxy.org/datasets/def456) |
```

---

## Key Benefits

### For Reproducibility

| Traditional Approach | With Loom |
|---------------------|------------------------|
| "I think we used HISAT2..." | Decision logged with rationale |
| "Check the Galaxy history" | Direct links to every dataset |
| "What parameters?" | All parameters captured in notebook |
| "Why did we filter at 0.05?" | QC checkpoint with observations |

### For Lab Efficiency

- **New members** can read past notebooks to learn analysis patterns
- **Collaborators** receive self-documenting analysis records
- **Publications** have ready-made methods sections
- **Reviews** can trace every decision

### For Research Quality

- **QC checkpoints** prevent proceeding with bad data
- **Researcher approval** required before each step
- **Complete audit trail** for every analysis
- **Persistent state** eliminates lost work

---

## Technical Details

### How It Works

1. **AI orchestration**: Claude-powered assistant understands bioinformatics workflows
2. **Galaxy integration**: Executes tools via Galaxy's API (MCP protocol)
3. **Structured state**: Plan/step/decision model ensures nothing is lost
4. **File persistence**: Markdown notebooks readable by humans AND machines

### What's Required

- Galaxy account (usegalaxy.org or local instance)
- Pi.dev CLI (`pip install pi-cli`)
- This extension (`pi install loom`)

### Privacy & Security

- Notebooks stay local (in your project directory)
- Galaxy credentials never stored in notebooks
- All data remains on your Galaxy server

---

## Next Steps

1. **Try it**: Run a small test analysis to see the workflow
2. **Evaluate**: Compare documentation quality to traditional approaches
3. **Adopt**: Integrate into lab analysis SOPs

---

## Questions?

The notebook format is:
- **Git-friendly**: Clean diffs, version controllable
- **Portable**: Standard markdown, no special tools needed to read
- **Extensible**: YAML blocks can capture additional metadata

The AI assistant:
- **Never runs without approval**: Every step requires researcher confirmation
- **Logs everything**: Decisions, rationale, observations
- **Resumes seamlessly**: Pick up exactly where you left off
