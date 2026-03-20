# GalaxyClaw

**Deep Galaxy bioinformatics integration for OpenClaw and NemoClaw.**

GalaxyClaw gives AI agents access to Galaxy's 8,000+ bioinformatics tools via [galaxy-mcp](https://github.com/galaxyproject/galaxy-mcp), the official Galaxy MCP server. The agent searches and runs tools dynamically -- no static catalogs that go stale. Every analysis is automatically reproducible through Galaxy's built-in provenance tracking.

## Architecture

GalaxyClaw is **pure SKILL.md** -- domain expertise that teaches the agent how to use galaxy-mcp effectively. No custom Python scripts duplicating Galaxy's API.

```
  Agent (OpenClaw / NemoClaw)
       │
       │  reads SKILL.md for domain knowledge
       │
       ▼
  galaxy-mcp (MCP server)
       │
       │  Galaxy API
       │
       ▼
  Galaxy Server (8,000+ tools, histories, workflows)
```

The SKILL.md files carry:
- Which tools to use for which tasks
- Parameter selection rationale (why Q20, why DP>10)
- QC checkpoints and what to look for
- Decision points (when to skip trimming, when to use STAR vs HISAT2)
- Common failure modes and fixes

## Quick Start

```bash
# Install galaxy-mcp
pip install galaxy-mcp

# Set Galaxy credentials
export GALAXY_URL=https://usegalaxy.org
export GALAXY_API_KEY=your-api-key-here

# Copy skills to OpenClaw/NemoClaw
cp -r skills/* ~/.openclaw/skills/
```

Then ask your agent:
- "Connect to Galaxy and check my account"
- "Search for quality control tools for FASTQ files"
- "Help me set up an RNA-seq differential expression experiment"
- "Run a metagenomics analysis on my shotgun sequencing data"

## Skills

| Skill | Type | Description |
|-------|------|-------------|
| **galaxy-connect** | Setup | Configure galaxy-mcp and authenticate |
| **galaxy-tools** | Reference | How to search, inspect, and run Galaxy tools |
| **galaxy-history** | Reference | How to manage histories and datasets |
| **galaxy-workflow** | Reference | How to import and run Galaxy workflows |
| **galaxy-rnaseq** | Domain guide | Full RNA-seq DE pipeline with QC checkpoints |
| **galaxy-variant** | Domain guide | Variant calling pipeline with filtering rationale |
| **galaxy-metagenomics** | Domain guide | Metagenomics profiling (Kraken2, MetaPhlAn, HUMAnN) |

## Why galaxy-mcp Instead of BioBlend Scripts?

Other Galaxy integrations (like ClawBio's Galaxy Bridge) ship custom Python scripts that parse a static tool catalog and make BioBlend calls. This approach has problems:
- Static catalogs go stale as Galaxy adds/updates tools
- Custom scripts duplicate Galaxy API logic that galaxy-mcp already handles
- No benefit from galaxy-mcp's tool validation contracts and parameter schemas

GalaxyClaw uses galaxy-mcp directly. The agent gets live tool search, proper parameter validation, and the full Galaxy API without maintaining wrapper code.

## NemoClaw Compatibility

Works with both OpenClaw and NemoClaw. NemoClaw's OpenShell sandbox provides additional security for genomic data -- the Privacy Router prevents sensitive data from leaking to cloud LLMs.

## Requirements

- [galaxy-mcp](https://github.com/galaxyproject/galaxy-mcp) (`pip install galaxy-mcp`)
- A Galaxy account with an API key ([get one here](https://usegalaxy.org/user/api_key))

## License

MIT
