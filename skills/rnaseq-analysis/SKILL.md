---
name: rnaseq-analysis
description: RNA-seq differential expression analysis template for Galaxy. Use when the researcher wants to analyze RNA-seq data, perform differential expression analysis, or work with transcriptomics data. Provides step-by-step guidance for the standard RNA-seq workflow.
version: 1.0.0
tags: [galaxy, rnaseq, transcriptomics, differential-expression, bioinformatics]
---

# RNA-seq Differential Expression Analysis

This skill provides the standard workflow template for bulk RNA-seq differential expression analysis in Galaxy. Use alongside the core `analysis-plan` skill.

## When to Use This Skill

Use this skill when:
- Researcher has RNA-seq FASTQ files
- Goal is differential gene expression analysis
- Comparing conditions (treatment vs control, disease vs healthy, etc.)
- Standard bulk RNA-seq (not single-cell)

## Prerequisites Checklist

Before starting, confirm with researcher:

- [ ] **Data available**: RNA-seq FASTQ files
- [ ] **Sequencing type**: Paired-end or single-end?
- [ ] **Sample metadata**: What conditions? How many replicates?
- [ ] **Reference**: Which organism/genome?
- [ ] **Comparison design**: Which conditions to compare?
- [ ] **Strand specificity**: Library prep method?

---

## Standard Workflow Steps

Use `analysis_plan_add_step` to add these to the plan.

### Step 1: Data Upload and Organization

**Purpose**: Get data into Galaxy and organize for analysis

**Execution**:
```
# Create dedicated history
mcp__galaxy__create_history("RNA-seq Analysis - [date] - [project]")

# Upload FASTQ files
mcp__galaxy__upload_file(path, history_id)
# or
mcp__galaxy__upload_file_from_url(url, history_id, file_type: "fastqsanger.gz")
```

**Inputs**: FASTQ files from local path or URLs

**Expected Outputs**: FASTQ datasets in Galaxy history

**QC Criteria**:
- All files uploaded successfully
- Correct file pairing (if paired-end)
- Sample names match metadata

---

### Step 2: Raw Read Quality Assessment

**Purpose**: Assess sequencing quality before processing

**Tool**: FastQC
- Galaxy ID: `toolshed.g2.bx.psu.edu/repos/devteam/fastqc/fastqc`

**Key Metrics to Check**:
| Metric | Good | Warning | Fail |
|--------|------|---------|------|
| Per base quality | >28 most bases | 20-28 | <20 |
| Per sequence quality | Peak >27 | Peak 20-27 | Peak <20 |
| Adapter content | <5% | 5-10% | >10% |
| Duplication | <20% | 20-50% | >50% |

**QC Criteria**:
- No critical failures
- Acceptable quality scores (>Q20 minimum)
- Adapter contamination level identified

**Decision Point**: If quality is poor, discuss with researcher:
- Trim more aggressively?
- Exclude low-quality samples?
- Re-sequence?

---

### Step 3: Read Trimming and Filtering

**Purpose**: Remove adapters and low-quality bases

**Tool Options**:
| Tool | Best For | Galaxy ID |
|------|----------|-----------|
| Trim Galore | Auto adapter detection | `toolshed.g2.bx.psu.edu/repos/bgruening/trim_galore/trim_galore` |
| Cutadapt | Manual adapter specification | `toolshed.g2.bx.psu.edu/repos/lparsons/cutadapt/cutadapt` |
| fastp | Speed + built-in QC | `toolshed.g2.bx.psu.edu/repos/iuc/fastp/fastp` |

**Typical Parameters**:
```
Quality threshold: 20
Minimum length: 20-36 bp (depends on read length)
Adapter: auto-detect or specify based on library kit
```

**Expected Outputs**: Trimmed FASTQ files

**QC Criteria**:
- Retention rate >80% (typical)
- Improved quality metrics post-trim
- Reasonable adapter removal

**Log Decision**: Record which trimmer and parameters used, and why.

---

### Step 4: Alignment to Reference

**Purpose**: Map reads to reference genome

**Tool Options**:
| Tool | Memory | Speed | Best For |
|------|--------|-------|----------|
| HISAT2 | Low | Fast | Most cases |
| STAR | High | Fast | High accuracy needed |
| Salmon | Low | Very fast | Quantification-focused |

**Tool IDs**:
- HISAT2: `toolshed.g2.bx.psu.edu/repos/iuc/hisat2/hisat2`
- STAR: `toolshed.g2.bx.psu.edu/repos/iuc/rgrnastar/rna_star`

**Key Parameters**:
```
Reference: Select built-in or upload custom
Strand specificity: Match library prep (RF for dUTP, FR for standard)
Output format: BAM (sorted by coordinate)
```

**Expected Outputs**: BAM alignment files

**QC Criteria**:
- Alignment rate >70-80%
- Consistent rates across samples
- High uniquely mapped percentage (>60%)

**Warning Signs**:
- Very low alignment (<50%): Wrong reference? Contamination?
- High multi-mapping: Repetitive regions? Reference quality?
- Variable rates across samples: Quality issue with some samples?

---

### Step 5: Alignment QC

**Purpose**: Validate alignment quality and characteristics

**Tools**:
| Tool | Provides |
|------|----------|
| RSeQC | Gene body coverage, read distribution, strand specificity |
| Picard CollectRnaSeqMetrics | Detailed RNA-seq specific metrics |
| MultiQC | Aggregate reports from multiple tools |

**Key Checks**:
- **Gene body coverage**: Should be relatively even 5' to 3'
- **Strand specificity**: Confirm matches library prep
- **Read distribution**: Most reads in exons/UTRs
- **Duplication rate**: Note for interpretation

**QC Criteria**:
- No 3' bias (indicates degradation)
- Strand specificity matches expectation
- Majority of reads in genic regions

---

### Step 6: Read Quantification

**Purpose**: Count reads per gene

**Tool Options**:
| Tool | Features |
|------|----------|
| featureCounts | Fast, flexible, standard choice |
| HTSeq-count | Conservative, reliable |
| Salmon | From pseudo-alignment, includes transcript quantification |

**Tool ID**: `toolshed.g2.bx.psu.edu/repos/iuc/featurecounts/featurecounts`

**Key Parameters**:
```
Feature type: gene (or exon for exon-level)
Attribute: gene_id (or gene_name)
Strand specificity: MUST match library prep and aligner settings
Count multi-mappers: Usually no for DE analysis
```

**Expected Outputs**: Count matrix (genes × samples)

**QC Criteria**:
- Reasonable total counts (millions per sample)
- Consistent counting across samples
- Expected number of detected genes

**Common Issues**:
- Zero counts for most genes: Wrong annotation? Strand setting?
- Low counting rate: Reads outside annotated regions?

---

### Step 7: Differential Expression Analysis

**Purpose**: Identify differentially expressed genes

**Tool Options**:
| Tool | Best For |
|------|----------|
| DESeq2 | Most cases, especially small sample sizes |
| edgeR | Similar to DESeq2, slightly different model |
| limma-voom | Larger sample sizes |

**Tool ID**: `toolshed.g2.bx.psu.edu/repos/iuc/deseq2/deseq2`

**Required Inputs**:
- Count matrix (from Step 6)
- Sample metadata / factor levels
- Comparison design (reference level)

**Key Parameters**:
```
Primary factor: Condition (e.g., "treatment")
Reference level: Control group
FDR threshold: 0.05 (typical)
Log2FC threshold: Optional, often 1.0
```

**Expected Outputs**:
- Results table (all genes with stats)
- Normalized counts
- MA plot
- PCA plot
- Volcano plot (if available)

**QC Criteria**:
- Samples cluster by condition in PCA
- Expected number of DE genes (varies by experiment)
- Reasonable effect sizes
- Known marker genes behave as expected

**Interpretation Notes**:
- Check for batch effects in PCA
- Outlier samples may need removal
- Very few DE genes: Low power? No real difference?
- Too many DE genes: Batch effect? Confounding?

---

### Step 8: Downstream Analysis (Optional)

**Purpose**: Biological interpretation of results

**Options**:

**GO Enrichment**:
- Tool: goseq, clusterProfiler wrapper
- Input: List of DE genes
- Output: Enriched GO terms

**Pathway Analysis**:
- Tool: KEGG pathway enrichment
- Identifies enriched biological pathways

**Visualization**:
- Heatmaps of DE genes
- Gene expression plots
- Volcano plots with labels

---

## IWC Workflow Recommendations

For standard RNA-seq, consider vetted IWC workflows:

```
mcp__galaxy__recommend_iwc_workflows("RNA-seq differential expression")
mcp__galaxy__search_iwc_workflows("RNA-seq HISAT2 featureCounts DESeq2")
```

**Common IWC Workflows**:
- `RNA-Seq-counts-to-genes` - Basic quantification
- `RNA-seq_PE_HISAT2_featureCounts` - PE alignment + counting
- Workflows with DESeq2 for full pipeline

**Advantage**: Pre-validated, community-tested, reproducible.

---

## Sample Plan Template

```
analysis_plan_create(
  title: "RNA-seq Differential Expression - [Project Name]",
  researchQuestion: "What genes are differentially expressed between [condition A] and [condition B]?",
  dataDescription: "N paired-end RNA-seq samples (X treatment, Y control) from [organism]",
  expectedOutcomes: [
    "List of differentially expressed genes",
    "Statistical results (log2FC, p-values)",
    "QC reports at each stage",
    "Visualizations (PCA, volcano, heatmap)"
  ],
  constraints: []
)
```

---

## Common Issues and Solutions

| Problem | Likely Cause | Solution |
|---------|--------------|----------|
| Low alignment rate | Wrong reference, contamination | Verify organism, check for rRNA |
| No DE genes | Low power, no biological difference | Check sample size, verify comparison |
| Too many DE genes | Batch effect, confounding | Check PCA for batch separation |
| Samples don't cluster | Mislabeling, batch effects | Verify sample metadata |
| 3' bias in coverage | RNA degradation | Note in interpretation |
| Strand mismatch | Wrong strandedness setting | Check library prep protocol |

---

## Decision Log Templates

**Tool Selection**:
```
analysis_step_log(
  stepId: "4",
  type: "tool_selection",
  description: "Selected HISAT2 for alignment over STAR",
  rationale: "Lower memory requirements, sufficient accuracy for DE analysis, built-in reference available",
  researcherApproved: true
)
```

**Parameter Choice**:
```
analysis_step_log(
  stepId: "6",
  type: "parameter_choice",
  description: "Set featureCounts to reverse strand (-s 2)",
  rationale: "Library prep used dUTP method (Illumina TruSeq Stranded)",
  researcherApproved: true
)
```

---

## Resources

- **Galaxy Training**: https://training.galaxyproject.org/topics/transcriptomics/
- **DESeq2 vignette**: Detailed statistical background
- **RNA-seq best practices**: ENCODE guidelines
