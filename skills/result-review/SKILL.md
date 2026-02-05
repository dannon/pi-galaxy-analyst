---
name: result-review
description: Review and interpret Galaxy analysis results. Use when examining outputs, summarizing findings, or helping researcher understand what results mean. Phase 4 of the research lifecycle.
version: 2.0.0
tags: [galaxy, results, interpretation, reporting, pathway, literature]
---

# Result Review

This skill provides guidance for reviewing analysis results and helping researchers interpret findings. This corresponds to Phase 4 (Interpretation) of the research lifecycle.

## Phase 4: Interpretation

After analysis (Phase 3) completes, transition to interpretation:

```
analysis_set_phase(
  phase: "interpretation",
  reason: "Analysis complete, reviewing results"
)
```

## When to Use

- After completing analysis steps
- When researcher asks what results mean
- Creating analysis summaries
- Comparing results across samples/conditions
- Connecting results to biological context
- Searching for relevant literature about findings

## Result Review Workflow

### 1. Retrieve Results

```
# Get output datasets from step
mcp__galaxy__get_history_contents(history_id, limit: 20)

# Get specific result details
mcp__galaxy__get_dataset_details(dataset_id, include_preview: true)
```

### 2. Contextualize

Connect results to:
- Original research question
- Input data characteristics
- Analysis parameters used
- Expected outcomes from plan

### 3. Assess Quality

- Does output look reasonable?
- Are values within expected ranges?
- Any warnings or flags?
- Consistent with prior steps?

### 4. Interpret

- What does this result tell us?
- How does it relate to the biology?
- Any unexpected findings?
- What are the limitations?

### 5. Literature Context

Connect findings to existing knowledge:

```
# Add literature supporting or contrasting findings
research_add_literature(
  title: "Gene X is a known regulator of inflammatory response",
  pmid: "12345678",
  relevance: "Supports our finding that Gene X is upregulated in treated samples"
)
```

**Key questions**:
- Have these genes/pathways been implicated in similar studies?
- Does prior research support or contradict our findings?
- What mechanisms have been proposed for these effects?

### 6. Document

```
analysis_step_log(
  stepId: "7",
  type: "observation",
  description: "DESeq2 identified 1,247 DE genes (FDR < 0.05)",
  rationale: "Reasonable number for this comparison; top genes include expected markers",
  researcherApproved: true
)
```

---

## Pathway and Enrichment Analysis

Connecting gene lists to biological functions is crucial for interpretation.

### Galaxy Enrichment Tools

| Tool | Purpose |
|------|---------|
| gProfiler | GO, KEGG, Reactome enrichment |
| DAVID | Functional annotation clustering |
| clusterProfiler | GO, KEGG with visualizations |
| Enrichr | Comprehensive gene set enrichment |

### Running Enrichment Analysis

```
# Search for enrichment tools
mcp__galaxy__search_tools_by_name("gProfiler")

# Typical input: gene list (one gene per line)
# Export significant DE genes from DESeq2 results
```

### Interpreting Enrichment Results

**Key metrics**:
- **p-value**: Statistical significance of enrichment
- **Adjusted p-value**: FDR-corrected significance
- **Gene ratio**: Proportion of your genes in the pathway
- **Background ratio**: Expected proportion

**Good practices**:
- Use appropriate background (all expressed genes, not all genes)
- Look for coherent themes across multiple terms
- Be skeptical of very large, generic pathways
- Note pathway databases have different coverage

### Documenting Pathway Findings

```
analysis_step_log(
  stepId: null,
  type: "interpretation",
  description: "GO enrichment reveals inflammatory response signature",
  rationale: "Top 5 GO terms: inflammatory response (p=1e-10), cytokine signaling (p=1e-8), NF-kB pathway (p=1e-7)...",
  researcherApproved: true
)
```

---

## Domain-Specific Interpretation

### RNA-seq DE Results

**Key Columns**:
| Column | Meaning |
|--------|---------|
| baseMean | Average expression level |
| log2FoldChange | Effect size (positive = up in treatment) |
| pvalue | Raw significance |
| padj | FDR-adjusted significance |

**Interpretation Guide**:
- padj < 0.05: Statistically significant
- |log2FC| > 1: 2-fold change (biologically meaningful?)
- High baseMean: Well-expressed genes, more reliable
- Low baseMean: May be noise

**QC Checks**:
- MA plot: Should be centered at 0
- PCA: Samples cluster by condition?
- Known markers: Behave as expected?

### Variant Calling Results

**Key Fields**:
| Field | Meaning |
|-------|---------|
| QUAL | Variant quality score |
| FILTER | Pass/fail filters |
| DP | Read depth |
| AF | Allele frequency |

**Interpretation Guide**:
- FILTER=PASS: Passed quality filters
- High DP: More confident call
- AF near 0.5: Heterozygous
- AF near 1.0: Homozygous alternate

### Alignment Statistics

**Key Metrics**:
| Metric | Good | Concerning |
|--------|------|------------|
| Overall alignment | >80% | <60% |
| Uniquely mapped | >70% | <50% |
| Duplication | <30% | >50% |
| Proper pairs | >90% | <80% |

---

## Summarizing Results

### For Step Completion

```
analysis_plan_update_step(
  stepId: "7",
  status: "completed",
  summary: "DESeq2 analysis complete. 1,247 genes significantly DE (FDR<0.05). Top upregulated: GENE1, GENE2. Top downregulated: GENE3, GENE4. PCA shows clear separation by treatment.",
  qcPassed: true
)
```

### For Final Report

Structure the summary:

1. **Key Findings**
   - Main results (numbers, key genes, etc.)
   - Statistical significance
   - Biological interpretation

2. **QC Summary**
   - All checkpoints passed?
   - Any caveats or limitations?

3. **Output Inventory**
   - List of deliverable files
   - What each contains

4. **Reproducibility**
   - Galaxy history ID
   - Tool versions
   - Key parameters

5. **Next Steps**
   - Suggested follow-up analyses
   - Validation recommendations

---

## Handling Unexpected Results

### No Significant Results

**Possible causes**:
- Low statistical power (few samples)
- No real biological difference
- Technical issues masked signal
- Wrong comparison

**Response**:
- Review sample sizes
- Check for batch effects
- Verify comparison design
- Discuss with researcher

### Too Many Significant Results

**Possible causes**:
- Batch effects
- Sample mislabeling
- Confounding variables
- Technical artifact

**Response**:
- Check PCA for batch separation
- Verify sample metadata
- Look for confounders
- Consider batch correction

### Results Don't Match Expectations

**Response**:
1. Verify analysis was correct
2. Check input data quality
3. Consider biological explanation
4. Document the discrepancy
5. Discuss implications with researcher

---

## Communication Patterns

### Explaining Results

**Good**: "The analysis found 847 genes significantly changed (FDR < 0.05). Among the top hits, BRCA1 shows 3-fold downregulation, which aligns with your hypothesis about DNA repair pathway disruption."

**Avoid**: "The padj column shows 847 values less than 0.05."

### Highlighting Concerns

**Good**: "I notice the samples don't cluster cleanly by treatment in the PCA. This could indicate batch effects or sample variability. Should we investigate further before interpreting the DE results?"

**Avoid**: "PCA looks weird."

### Suggesting Next Steps

**Good**: "Given the enrichment in immune pathways, you might want to consider: (1) validating top hits with qPCR, (2) pathway-level visualization, or (3) comparison with public datasets of similar treatments."

---

## Logging Final Observations

```
analysis_step_log(
  stepId: null,  # Plan-level observation
  type: "interpretation",
  description: "Analysis complete. Key finding: Treatment induces strong inflammatory response signature (847 DE genes, FDR<0.05). Results support hypothesis that treatment activates NF-kB pathway.",
  rationale: "Top GO terms include 'inflammatory response', 'cytokine signaling'. Known NF-kB targets (IL6, TNF, NFKBIA) strongly upregulated.",
  researcherApproved: true
)
```

---

## Transitioning to Publication (Phase 5)

When interpretation is complete and results are validated:

```
analysis_set_phase(
  phase: "publication",
  reason: "Results interpreted and validated, ready for publication prep"
)
```

Use the **publication-prep** skill for:
- Generating methods section from analysis steps
- Planning figures based on key findings
- Preparing supplementary data tables
- Setting up data sharing (GEO, Zenodo)

### Checklist Before Publication Phase

- [ ] All key findings documented
- [ ] Statistical significance verified
- [ ] Biological interpretation makes sense
- [ ] Unexpected results investigated
- [ ] Literature context established
- [ ] QC checkpoints all passed
