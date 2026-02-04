---
name: data-assessment
description: Assess and inspect Galaxy datasets for quality and characteristics. Use when examining data before or during analysis, checking job outputs, or diagnosing data issues.
version: 1.0.0
tags: [galaxy, qc, data, inspection]
---

# Data Assessment

This skill provides guidance for inspecting and assessing Galaxy datasets.

## When to Use

- Before starting analysis (understand what you're working with)
- After each step (verify outputs look correct)
- When troubleshooting unexpected results
- When researcher asks "what does this data look like?"

## Quick Data Inspection

### Get Dataset Info

```
# Basic info
mcp__galaxy__get_dataset_details(dataset_id)

# With preview of contents
mcp__galaxy__get_dataset_details(dataset_id, include_preview: true, preview_lines: 20)
```

### Key Fields to Check

| Field | What to Look For |
|-------|------------------|
| `state` | Should be `ok`; `error` means job failed |
| `file_ext` | Correct file type? |
| `file_size` | Reasonable size? Not 0? |
| `genome_build` | Correct reference? |
| `metadata` | Columns, lines, etc. for tabular |

### History Overview

```
# Recent datasets
mcp__galaxy__get_history_contents(history_id, limit: 20)

# Specific range
mcp__galaxy__get_history_contents(history_id, limit: 50, offset: 0, order: "hid-asc")
```

---

## File Type Assessments

### FASTQ Files

**Check for**:
- Read count (via stats or FastQC)
- Read length distribution
- Quality score profile
- Adapter contamination

**Tools**:
- FastQC (comprehensive)
- seqtk stats (quick counts)

### BAM Files

**Check for**:
- Alignment statistics (samtools stats)
- Read groups present
- Sorted status
- Index availability

**Tools**:
- SAMtools flagstat
- SAMtools idxstats
- BAM coverage plots

### VCF Files

**Check for**:
- Variant counts
- FILTER status distribution
- Sample names
- Header completeness

**Quick inspection**:
- SnpSift Stats
- bcftools stats

### Tabular/Count Files

**Check for**:
- Column count and headers
- Row count
- Data types per column
- Missing values

**Preview first**:
```
mcp__galaxy__get_dataset_details(dataset_id, include_preview: true)
```

---

## QC Checkpoint Patterns

### Pre-Analysis Checkpoint

```
analysis_checkpoint(
  stepId: "1",
  name: "Input Data Validation",
  criteria: [
    "All expected files present",
    "File types correct",
    "Sample names match metadata",
    "No obvious corruption"
  ],
  status: "passed",
  observations: ["10 FASTQ files uploaded", "All paired correctly"]
)
```

### Post-Tool Checkpoint

```
analysis_checkpoint(
  stepId: "3",
  name: "Post-Trimming QC",
  criteria: [
    "Output files created",
    "Reasonable retention rate",
    "Quality improved"
  ],
  status: "passed",
  observations: [
    "85% reads retained",
    "Adapter content reduced from 8% to <1%"
  ]
)
```

---

## Troubleshooting Empty/Failed Datasets

### Dataset State = Error

1. Check job details:
   ```
   mcp__galaxy__get_job_details(dataset_id)
   ```

2. Look for:
   - `stderr` - Error messages
   - `exit_code` - Non-zero indicates failure
   - `state` - Why it failed

3. Common causes:
   - Wrong input format
   - Missing dependencies
   - Resource limits
   - Invalid parameters

### Dataset Empty or Tiny

1. Verify input wasn't empty
2. Check tool parameters (filters too strict?)
3. Look at intermediate outputs
4. Check job logs for warnings

### Dataset Shows Wrong Type

1. May need datatype reassignment
2. Check if tool output correct format
3. Verify input was correct type

---

## Gotchas

From galaxy-skills:

- **HID vs Dataset ID**: MCP uses long dataset IDs, not the numbers shown in UI
- **Preview limits**: Large files won't show completely in preview
- **Visible filter**: Hidden datasets need `visible: false` to see
- **Job timing**: Dataset may show `new` or `queued` while job runs

---

## Logging Observations

Always log what you find:

```
analysis_step_log(
  stepId: "2",
  type: "observation",
  description: "FastQC shows 12% adapter content in all samples",
  rationale: "Higher than typical; will use aggressive trimming",
  researcherApproved: true
)
```
