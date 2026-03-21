---
name: galaxy-claw
description: "Deep Galaxy bioinformatics integration via galaxy-mcp -- connect to any Galaxy server, search/run 8,000+ tools, manage histories and workflows, with guided domain pipelines for RNA-seq, variant calling, and metagenomics"
version: 0.2.0
author: Galaxy Project
license: MIT
tags: [galaxy, bioinformatics, genomics, workflows, reproducibility, nemoclaw, mcp]
---

# GalaxyClaw -- Galaxy for OpenClaw/NemoClaw

**Deep integration with Galaxy bioinformatics servers via galaxy-mcp.** Not just tool search -- full history management, workflow execution, dataset lineage, and guided analysis pipelines.

## Architecture

GalaxyClaw uses **galaxy-mcp** (the official Galaxy MCP server) as the execution layer. No custom Python scripts duplicating Galaxy's API -- the agent talks to Galaxy directly through MCP tools. These SKILL.md files provide the domain expertise the agent needs to use those tools effectively.

```
  Agent (OpenClaw / NemoClaw)
       │
       │  reads SKILL.md for domain knowledge
       │
       ▼
  galaxy-mcp (MCP server)
       │
       │  BioBlend / Galaxy API
       │
       ▼
  Galaxy Server (usegalaxy.org, etc.)
       │
       ▼
  8,000+ tools, histories, workflows, provenance
```

## Sub-Skills

| Skill | Purpose |
|-------|---------|
| `galaxy-connect` | Configure galaxy-mcp and authenticate with any Galaxy server |
| `galaxy-tools` | Search, inspect, and run any Galaxy tool via MCP |
| `galaxy-history` | Create/browse/share histories and datasets via MCP |
| `galaxy-workflow` | Import and run published Galaxy workflows via MCP |
| `galaxy-rnaseq` | Guided RNA-seq differential expression pipeline |
| `galaxy-variant` | Guided variant calling pipeline |
| `galaxy-metagenomics` | Guided metagenomics profiling pipeline |

## Quick Start

1. Install galaxy-mcp: `pip install galaxy-mcp` (or `uvx galaxy-mcp`)
2. Set credentials: `export GALAXY_URL=https://usegalaxy.org && export GALAXY_API_KEY=your-key`
3. Copy skills: `cp -r galaxy-claw/skills/* ~/.openclaw/skills/`
4. Ask your agent: "Connect to Galaxy and help me run FastQC on my sequencing reads"

## Why Galaxy?

- **8,000+ tools** maintained by a global community -- always up to date
- **Full provenance** -- every parameter, input, and output tracked automatically
- **Reproducibility** -- Galaxy histories are shareable and re-runnable
- **Server-side compute** -- tools run on Galaxy infrastructure, not your laptop
- **Multi-server** -- connect to usegalaxy.org, usegalaxy.eu, or any institutional Galaxy
- **No static catalogs** -- galaxy-mcp searches the live tool panel dynamically
