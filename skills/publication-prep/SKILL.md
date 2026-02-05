---
name: publication-prep
description: Publication preparation for Galaxy analyses. Use when generating methods sections, recommending figures, preparing data for sharing, or preparing materials for manuscript submission.
version: 1.0.0
tags: [galaxy, publication, methods, figures, data-sharing]
---

# Publication Preparation

This skill guides preparation of publication materials from completed Galaxy analyses, including methods sections, figure recommendations, and data sharing preparation.

## When to Use This Skill

Use this skill when:
- Analysis is complete and ready for publication
- Generating methods section text
- Planning/tracking figures for manuscript
- Preparing data for GEO/Zenodo submission
- Creating supplementary materials

## Quick Reference

| Tool | Purpose |
|------|---------|
| `publication_init` | Start publication prep, set target journal |
| `publication_generate_methods` | Generate methods from analysis steps |
| `publication_recommend_figures` | Get figure suggestions for analysis type |
| `publication_add_figure` | Add figure to tracking |
| `publication_update_figure` | Update figure status/dataset |
| `publication_get_status` | View publication prep status |

---

## Phase 5: Publication Preparation

This is Phase 5 of the 5-phase research lifecycle. After analysis (Phase 3) and interpretation (Phase 4), prepare materials for publication.

### Publication Workflow

```
1. Initialize
   └── publication_init with target journal
2. Generate Methods
   └── publication_generate_methods extracts tool info
3. Plan Figures
   └── publication_recommend_figures for suggestions
   └── publication_add_figure for each planned figure
4. Generate Figures
   └── Use Galaxy tools to create visualizations
   └── publication_update_figure to link datasets
5. Prepare Supplementary
   └── Export tables, datasets
6. Data Sharing
   └── Prepare GEO/Zenodo submission files
```

---

## Generating Methods Section

### Basic Methods Generation

```
publication_generate_methods(
  includeVersions: true,
  style: "narrative"
)
```

**Output includes**:
- Galaxy server used
- Tools executed with versions
- Key parameters
- Reference to Galaxy history

### Methods Template

Generated methods follow this structure:

```markdown
Analysis was performed using Galaxy (usegalaxy.org).

**Quality Control**: Raw reads were assessed using FastQC (v0.11.9).

**Read Mapping**: Reads were aligned to the reference genome (GRCh38)
using STAR (v2.7.10a) with default parameters.

**Quantification**: Gene-level counts were generated using featureCounts
(v2.0.1) with the GENCODE v38 annotation.

**Differential Expression**: Differential expression analysis was
performed using DESeq2 (v1.34.0) with FDR < 0.05.

The complete analysis is available in Galaxy history [ID] at [URL].
```

### Journal-Specific Formatting

Different journals have different requirements:

| Journal Type | Style Notes |
|--------------|-------------|
| Nature family | Brief methods, supplementary details |
| NAR | Detailed methods acceptable |
| BMC | Standard structured format |
| PLOS | Materials & Methods section |

---

## Figure Planning

### Get Recommendations

Based on analysis type:

```
publication_recommend_figures(analysisType: "rnaseq")
```

**RNA-seq recommendations**:
1. QC Summary (MultiQC)
2. PCA Plot
3. Sample Correlation Heatmap
4. Volcano Plot
5. MA Plot
6. Top DE Genes Heatmap

### Add Figures to Plan

```
publication_add_figure(
  name: "Figure 1: Sample Quality Summary",
  type: "qc_plot",
  dataSource: "step-1",  # QC step
  description: "MultiQC summary of all samples showing per-base quality, adapter content, and GC distribution",
  suggestedTool: "multiqc"
)

publication_add_figure(
  name: "Figure 2: Principal Component Analysis",
  type: "pca",
  dataSource: "step-7",  # DE analysis step
  description: "PCA plot showing sample clustering by condition. PC1 and PC2 explain X% and Y% of variance respectively.",
  suggestedTool: "deseq2"
)
```

### Figure Types and Galaxy Tools

| Figure Type | Galaxy Tools |
|-------------|--------------|
| `qc_plot` | MultiQC, FastQC |
| `pca` | DESeq2, limma, plotPCA |
| `heatmap` | Heatmap2, pheatmap |
| `volcano` | VolcanoPlot, EnhancedVolcano |
| `ma_plot` | DESeq2, plotMA |
| `pathway` | gProfiler, DAVID, clusterProfiler |
| `coverage` | deepTools bamCoverage + plotProfile |
| `alignment` | MultiQC (alignment section) |

### Track Figure Progress

```
# After generating figure in Galaxy
publication_update_figure(
  figureId: "fig-1",
  status: "generated",
  galaxyDatasetId: "abc123"
)

# After finalizing for submission
publication_update_figure(
  figureId: "fig-1",
  status: "finalized"
)
```

---

## Common Figure Requirements

### RNA-seq Publications

**Essential figures**:
1. **QC Summary**: Show data quality
2. **PCA/MDS**: Show sample relationships
3. **Volcano or MA**: Show DE distribution
4. **Heatmap**: Show top DE genes

**Optional figures**:
- GO enrichment bar plot
- Pathway visualization
- Gene expression trends

### Variant Calling Publications

**Essential figures**:
1. **Coverage plot**: Read depth across regions
2. **Variant quality distribution**
3. **Allele frequency histogram**
4. **Annotation summary** (VEP/snpEff categories)

### Single-Cell Publications

**Essential figures**:
1. **QC violin plots**: nGenes, nCounts, %mito
2. **UMAP/t-SNE**: Cluster visualization
3. **Cluster markers**: Dot plot or heatmap
4. **Cell type proportions**

---

## Data Sharing Preparation

### GEO Submission

For RNA-seq data, GEO requires:

1. **Raw data**: Original FASTQ files
2. **Processed data**: Count matrices, normalized data
3. **Metadata**: Sample information spreadsheet
4. **Protocols**: Brief methods

**Steps**:
```
# 1. Export count matrix from Galaxy
mcp__galaxy__get_dataset_details(counts_dataset_id)

# 2. Generate sample metadata from provenance
data_get_provenance()

# 3. Prepare submission package
# - raw/: FASTQ files (or SRA accessions if from public data)
# - processed/: counts.txt, normalized.txt
# - metadata.xlsx: Sample information
```

### Zenodo Deposition

For Galaxy histories and workflows:

1. **History export**: Galaxy can export histories
2. **Workflow**: Export .ga file
3. **Data files**: Key result files
4. **Documentation**: README with reproduction steps

---

## Reproducibility Documentation

### Minimum Reproducibility Info

Every publication should include:

| Item | Source |
|------|--------|
| Galaxy server URL | plan.galaxy.serverUrl |
| History ID | plan.galaxy.historyId |
| Tool versions | publication.methodsDraft.toolVersions |
| Reference genome | Step parameters |
| Annotation version | Step parameters |

### Creating Reproducibility Statement

```
The complete analysis workflow is available in Galaxy history [ID]
at [SERVER_URL]. The workflow can be reproduced using Galaxy workflow
[WORKFLOW_ID]. All tool versions are listed in Supplementary Table X.
```

---

## Supplementary Materials

### Common Supplementary Tables

| Table | Content |
|-------|---------|
| S1 | Sample metadata (conditions, replicates) |
| S2 | Tool versions and parameters |
| S3 | Complete DE gene list (all, not just significant) |
| S4 | GO/pathway enrichment results |
| S5 | Quality metrics per sample |

### Exporting from Galaxy

```
# Get dataset for download
mcp__galaxy__get_dataset_details(dataset_id)

# For tabular data, preview shows content
mcp__galaxy__get_dataset_details(dataset_id, include_preview: true)
```

---

## Workflow Example

### Complete Publication Prep

```
# 1. Initialize
publication_init(targetJournal: "Nucleic Acids Research")

# 2. Generate methods
publication_generate_methods(includeVersions: true, style: "narrative")

# 3. Get figure recommendations
publication_recommend_figures(analysisType: "rnaseq")

# 4. Add planned figures
publication_add_figure(
  name: "Figure 1: Data Quality",
  type: "qc_plot",
  dataSource: "1",
  description: "MultiQC report showing per-sample quality metrics"
)

publication_add_figure(
  name: "Figure 2: Sample Clustering",
  type: "pca",
  dataSource: "7",
  description: "PCA showing separation by treatment condition"
)

# 5. Generate figures in Galaxy
# [Use appropriate Galaxy tools]

# 6. Link generated figures
publication_update_figure(figureId: "fig-1", status: "generated", galaxyDatasetId: "...")

# 7. Check status
publication_get_status()
```

---

## Checklist Before Submission

### Methods Section
- [ ] All tools mentioned with versions
- [ ] Key parameters documented
- [ ] Reference genome/annotation specified
- [ ] Galaxy history ID included
- [ ] Statistical methods described

### Figures
- [ ] All figures generated and finalized
- [ ] Captions written
- [ ] High-resolution exports available
- [ ] Figure files named appropriately

### Data Sharing
- [ ] Raw data deposited (if applicable)
- [ ] Processed data available
- [ ] Code/workflow shared
- [ ] Reproducibility statement included

### Supplementary Materials
- [ ] Complete gene lists exported
- [ ] Quality metrics table prepared
- [ ] Tool versions table created
- [ ] Sample metadata documented

---

## Common Issues

### Missing Tool Versions

**Problem**: Methods generator can't find versions

**Solution**: Galaxy stores versions in job info. Check completed steps:
```
mcp__galaxy__get_job_details(dataset_id)
```
Look for `tool_version` field.

### Figure Quality

**Problem**: Galaxy plots are low resolution

**Solutions**:
- Use Galaxy tools that export PDF/SVG
- Adjust plot dimensions in tool parameters
- Export data and recreate in R/Python

### Large Data Files

**Problem**: Count matrices too large for supplementary

**Solutions**:
- Deposit in GEO/Zenodo
- Provide as separate download
- Include compressed version

---

## Resources

- **GEO Submission Guide**: https://www.ncbi.nlm.nih.gov/geo/info/submission.html
- **Zenodo**: https://zenodo.org
- **Galaxy Workflow Sharing**: https://galaxyproject.org/learn/share/
- **FAIR Principles**: https://www.go-fair.org/fair-principles/
