---
name: data-acquisition
description: Data acquisition and organization for Galaxy analysis. Use when searching public repositories (GEO, SRA, ENA), importing data to Galaxy, creating samplesheets, or organizing files for analysis pipelines.
version: 1.0.0
tags: [galaxy, data, geo, sra, import, samplesheet]
---

# Data Acquisition

This skill guides data acquisition from public repositories and local sources, with proper provenance tracking and samplesheet generation for analysis pipelines.

## When to Use This Skill

Use this skill when:
- Searching for public datasets (GEO, SRA, ENA)
- Importing public data into Galaxy
- Organizing local/uploaded data files
- Creating samplesheets for pipelines
- Tracking data provenance

## Quick Reference

| Tool | Purpose |
|------|---------|
| `data_set_source` | Initialize data provenance (GEO, SRA, local, etc.) |
| `data_add_sample` | Add sample with metadata |
| `data_add_file` | Add file with type and pairing info |
| `data_link_galaxy` | Link file to Galaxy dataset after import |
| `data_generate_samplesheet` | Generate samplesheet CSV/TSV |
| `data_get_provenance` | Get current data status |

---

## Phase 2: Data Acquisition Workflow

This is Phase 2 of the 5-phase research lifecycle. After refining the research question (Phase 1), acquire and organize data before analysis.

### Workflow Overview

```
1. Search/Identify Data
   └── Public repo search OR local file upload
2. Initialize Provenance
   └── data_set_source with accession
3. Register Samples
   └── data_add_sample for each biological sample
4. Register Files
   └── data_add_file with R1/R2 pairing
5. Import to Galaxy
   └── Use Galaxy MCP tools
6. Link to Galaxy
   └── data_link_galaxy for provenance chain
7. Generate Samplesheet
   └── data_generate_samplesheet for pipelines
```

---

## Searching Public Data

### GEO (Gene Expression Omnibus)

GEO contains gene expression datasets. Use web search to find datasets:

```
# Search strategy
"GEO GSE [keywords] [organism]"
"site:ncbi.nlm.nih.gov/geo [keywords]"
```

**Key GEO concepts**:
- **GSE**: Series (the main entry point - contains samples and data)
- **GSM**: Samples (individual biological samples)
- **GPL**: Platform (the array/sequencing technology used)

### SRA (Sequence Read Archive)

SRA contains raw sequencing data. Every GEO RNA-seq dataset links to SRA.

**SRA identifiers**:
- **SRP**: Study (project)
- **SRX**: Experiment
- **SRR**: Run (the actual FASTQ files)

### Finding SRA accessions from GEO

1. Go to GEO series page (e.g., GSE12345)
2. Look for "SRA Run Selector" link
3. Note the SRP number for Galaxy import

---

## Importing to Galaxy

### Using Galaxy's Built-in Tools

Galaxy has native tools for fetching public data:

```
# Search for SRA import tool
mcp__galaxy__search_tools_by_name("sra")

# Common tools:
# - "faster-download" (SRA download)
# - "fasterq-dump" (SRA to FASTQ)
# - "upload1" (URL upload)
```

### Import from SRA

```
# Get tool details
mcp__galaxy__get_tool_details("toolshed.g2.bx.psu.edu/repos/iuc/sra_tools/fasterq_dump/...")

# Run the import
mcp__galaxy__run_tool(
  history_id: "...",
  tool_id: "fasterq_dump",
  inputs: {
    "input|input_select": "accession_number",
    "input|accession": "SRR1234567"
  }
)
```

### Import from URL

For direct file URLs:

```
mcp__galaxy__run_tool(
  history_id: "...",
  tool_id: "upload1",
  inputs: {
    "files_0|url_paste": "https://example.com/file.fastq.gz",
    "files_0|type": "fastqsanger.gz"
  }
)
```

---

## Tracking Provenance

### Initialize Data Source

Always start by recording where the data comes from:

```
data_set_source(
  source: "geo",
  accession: "GSE12345",
  downloadDate: "2024-01-15"
)
```

### Register Samples

Add each biological sample with condition information:

```
data_add_sample(
  id: "sample1",
  name: "Control_Rep1",
  condition: "control",
  replicate: 1,
  metadata: {
    "cell_line": "HeLa",
    "treatment": "none",
    "time_point": "0h"
  },
  files: ["file1", "file2"]  # Will link after adding files
)
```

### Register Files

Add files with type and pairing information:

```
# For paired-end reads
data_add_file(
  id: "file1",
  name: "sample1_R1.fastq.gz",
  type: "fastq",
  format: "fastq.gz",
  readType: "paired",
  pairedWith: "file2"
)

data_add_file(
  id: "file2",
  name: "sample1_R2.fastq.gz",
  type: "fastq",
  format: "fastq.gz",
  readType: "paired",
  pairedWith: "file1"
)
```

### Link to Galaxy Datasets

After importing to Galaxy, link the provenance:

```
data_link_galaxy(
  fileId: "file1",
  galaxyDatasetId: "abc123"
)
```

---

## File Organization Patterns

### FASTQ Naming Conventions

Common patterns to detect read pairs:

| Pattern | R1 | R2 |
|---------|-----|-----|
| Illumina | `_R1_001.fastq.gz` | `_R2_001.fastq.gz` |
| Standard | `_1.fastq.gz` | `_2.fastq.gz` |
| SRA | `_1.fastq` | `_2.fastq` |

### Auto-Detecting File Types

When examining uploaded files:

```
mcp__galaxy__get_dataset_details(dataset_id, include_preview: true)
```

Look at:
- File extension for format
- Preview content for structure
- FASTQ headers for platform/read info

---

## Generating Samplesheets

### nf-core Format

nf-core pipelines expect specific samplesheet formats:

```
data_generate_samplesheet(
  format: "csv",
  columns: ["sample", "fastq_1", "fastq_2", "strandedness"],
  includeMetadata: true
)
```

**Output example**:
```csv
sample,fastq_1,fastq_2,strandedness
Control_Rep1,abc123,def456,reverse
Control_Rep2,ghi789,jkl012,reverse
Treated_Rep1,mno345,pqr678,reverse
```

### Galaxy Workflow Format

For Galaxy collection input:

```
data_generate_samplesheet(
  format: "csv",
  columns: ["sample", "condition", "forward", "reverse"],
  includeMetadata: true
)
```

---

## Complete Example: GEO Import

Here's a full workflow for importing a GEO dataset:

### 1. Record the source

```
data_set_source(
  source: "geo",
  accession: "GSE164073",
  downloadDate: "2024-01-15"
)
```

### 2. Add samples (from GEO series matrix)

```
data_add_sample(
  id: "SRR13284001",
  name: "Control_1",
  condition: "control",
  replicate: 1,
  files: ["SRR13284001_1", "SRR13284001_2"]
)

data_add_sample(
  id: "SRR13284002",
  name: "Treated_1",
  condition: "treated",
  replicate: 1,
  files: ["SRR13284002_1", "SRR13284002_2"]
)
```

### 3. Register files

```
# For each sample, add R1 and R2
data_add_file(
  id: "SRR13284001_1",
  name: "SRR13284001_1.fastq",
  type: "fastq",
  readType: "paired",
  pairedWith: "SRR13284001_2"
)

data_add_file(
  id: "SRR13284001_2",
  name: "SRR13284001_2.fastq",
  type: "fastq",
  readType: "paired",
  pairedWith: "SRR13284001_1"
)
```

### 4. Import to Galaxy

```
# Use Galaxy's SRA download
mcp__galaxy__run_tool(
  history_id: "...",
  tool_id: "fasterq_dump",
  inputs: { "input|accession": "SRR13284001" }
)
```

### 5. Link Galaxy datasets

After jobs complete, link:

```
data_link_galaxy(fileId: "SRR13284001_1", galaxyDatasetId: "...")
data_link_galaxy(fileId: "SRR13284001_2", galaxyDatasetId: "...")
```

### 6. Generate samplesheet

```
data_generate_samplesheet(
  format: "csv",
  columns: ["sample", "fastq_1", "fastq_2", "condition"]
)
```

---

## Transitioning to Analysis

Once data is organized and imported:

1. Verify all files are linked to Galaxy datasets
2. Generate samplesheet if needed
3. Transition to Analysis phase:

```
analysis_set_phase(
  phase: "analysis",
  reason: "Data imported and organized, ready for processing"
)
```

---

## Common Issues

### Missing Paired Files

**Problem**: Only R1 files found, missing R2

**Solutions**:
- Check if single-end sequencing (not all data is paired)
- Verify file naming pattern
- Check SRA metadata for library layout

### Import Fails

**Problem**: Galaxy import tool errors

**Solutions**:
- Check accession is valid (SRR not GSM)
- Verify Galaxy server can reach SRA/ENA
- Try alternative import method (URL vs accession)

### Samplesheet Doesn't Match Files

**Problem**: Samplesheet references don't match Galaxy datasets

**Solutions**:
- Ensure `data_link_galaxy` was called for all files
- Check `data_get_provenance` for missing links
- Regenerate samplesheet after linking

---

## Resources

- **GEO**: https://www.ncbi.nlm.nih.gov/geo/
- **SRA**: https://www.ncbi.nlm.nih.gov/sra
- **ENA**: https://www.ebi.ac.uk/ena
- **Galaxy Training**: https://training.galaxyproject.org/training-material/topics/galaxy-interface/tutorials/upload-rules/tutorial.html
