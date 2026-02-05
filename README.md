# Pi-Galaxy-Analyst

A [Pi.dev](https://pi.dev) package that transforms Pi into a Galaxy-focused co-scientist agent for bioinformatics analysis.

## What It Does

Pi-Galaxy-Analyst provides a **complete research lifecycle platform** — a structured approach to bioinformatics workflows covering everything from problem definition through publication:

```
┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
│  Phase 1   │ → │  Phase 2   │ → │  Phase 3   │ → │  Phase 4   │ → │  Phase 5   │
│  PROBLEM   │   │   DATA     │   │  ANALYSIS  │   │  INTERPRET │   │  PUBLISH   │
│  DEFINE    │   │  ACQUIRE   │   │            │   │            │   │            │
└────────────┘   └────────────┘   └────────────┘   └────────────┘   └────────────┘
```

### The Five Phases

| Phase | What Happens | Key Tools |
|-------|--------------|-----------|
| **1. Problem Definition** | Refine research question, review literature | `research_question_refine`, `research_add_literature` |
| **2. Data Acquisition** | Find public data, import to Galaxy, create samplesheets | `data_set_source`, `data_generate_samplesheet` |
| **3. Analysis** | Execute tools/workflows with QC checkpoints | `analysis_plan_*`, Galaxy MCP tools |
| **4. Interpretation** | Review results, biological context, pathway analysis | `result-review` skill |
| **5. Publication** | Generate methods, track figures, prepare data sharing | `publication_generate_methods`, `publication_add_figure` |

The agent works WITH you, not FOR you — you make the decisions, it helps execute them rigorously.

## Quick Start

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/galaxyproject/pi-galaxy-analyst/main/install.sh | bash
```

Then run:
```bash
galaxy-analyst
```

The first time you run it, you'll be prompted for your Galaxy server URL and API key.

### What Gets Installed

- **Pi coding agent** — The AI agent framework
- **pi-mcp-adapter** — Connects Pi to MCP servers
- **galaxy-mcp** — MCP server for Galaxy API
- **pi-galaxy-analyst** — This package (skills + extensions)

## Manual Installation

If you prefer to install components separately:

### Prerequisites

1. Node.js 18+
2. [Pi coding agent](https://github.com/badlogic/pi-mono)
3. [uv](https://github.com/astral-sh/uv) or Python 3.10+

### Install Steps

```bash
# 1. Install Pi if needed
npm install -g @mariozechner/pi-coding-agent

# 2. Install pi-mcp-adapter
pi install npm:pi-mcp-adapter

# 3. Clone and install pi-galaxy-analyst
git clone https://github.com/galaxyproject/pi-galaxy-analyst.git
pi install git:./pi-galaxy-analyst

# 4. Clone galaxy-mcp
git clone https://github.com/galaxyproject/galaxy-mcp.git ~/.galaxy-mcp
```

### Configure Galaxy MCP

Create `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    "galaxy": {
      "command": "uv",
      "args": ["run", "--python", "3.12", "--directory", "~/.galaxy-mcp/mcp-server-galaxy-py", "galaxy-mcp"],
      "lifecycle": "lazy",
      "directTools": [
        "connect", "get_histories", "create_history",
        "get_history_contents", "get_dataset_details",
        "upload_file", "search_tools_by_name",
        "get_tool_details", "run_tool", "get_job_details",
        "recommend_iwc_workflows", "invoke_workflow",
        "get_invocations"
      ]
    }
  }
}
```

Note: Python 3.12 is specified because newer Python versions (3.14+) have compatibility issues with pydantic-core.

### Set Galaxy Credentials

Either via environment:
```bash
export GALAXY_URL="https://usegalaxy.org"
export GALAXY_API_KEY="your-api-key"
```

Or use `/connect` command after starting — it will prompt you interactively.

### Using Local LLMs (Optional)

To use a local LLM provider like [LiteLLM](https://litellm.ai/) instead of commercial APIs:

1. Create `~/.pi/agent/models.json`:
```json
{
  "providers": {
    "litellm": {
      "baseUrl": "http://localhost:4000/v1",
      "api": "openai-completions",
      "apiKey": "your-litellm-key",
      "models": [
        {
          "id": "your-model-name",
          "contextWindow": 128000,
          "maxTokens": 16384
        }
      ]
    }
  }
}
```

2. Create `~/.pi/agent/settings.json`:
```json
{
  "defaultProvider": "litellm",
  "defaultModel": "your-model-name"
}
```

The `api` field should be `openai-completions` for most OpenAI-compatible APIs.

## Usage

Start Pi and begin an analysis conversation:

```
$ pi

You: I have RNA-seq data from a drug treatment experiment. 6 samples - 3 treated, 3 control.
     I want to find differentially expressed genes.

Pi: I'll help you set up a structured RNA-seq differential expression analysis...
    [Creates analysis plan, walks through each step with you]
```

### Commands

| Command | Description |
|---------|-------------|
| `/connect` | Connect to Galaxy (prompts for credentials if not set) |
| `/status` | Show Galaxy connection and plan status |
| `/plan` | View current analysis plan summary |
| `/plan-decisions` | View recent decisions in the analysis |
| `/notebook` | View notebook info or list available notebooks |

### Skills Provided

| Skill | Phase | Purpose |
|-------|-------|---------|
| `analysis-plan` | 1-5 | Core plan-based protocol, phase transitions |
| `data-acquisition` | 2 | GEO/SRA search, Galaxy import, samplesheets |
| `rnaseq-analysis` | 3 | RNA-seq differential expression workflows |
| `data-assessment` | 3 | Inspecting and validating data |
| `result-review` | 4 | Results interpretation, pathway analysis |
| `publication-prep` | 5 | Methods, figures, data sharing prep |

### Custom Tools

The extension registers tools for each phase:

#### Phase Management
| Tool | Purpose |
|------|---------|
| `analysis_set_phase` | Transition between lifecycle phases |

#### Phase 1: Problem Definition
| Tool | Purpose |
|------|---------|
| `research_question_refine` | Refine hypothesis with PICO framework |
| `research_add_literature` | Add literature reference |

#### Phase 2: Data Acquisition
| Tool | Purpose |
|------|---------|
| `data_set_source` | Set data source (GEO, SRA, local) |
| `data_add_sample` | Register sample with metadata |
| `data_add_file` | Register file with pairing info |
| `data_link_galaxy` | Link to Galaxy dataset |
| `data_generate_samplesheet` | Create pipeline samplesheet |
| `data_get_provenance` | View data provenance summary |

#### Phase 3: Analysis
| Tool | Purpose |
|------|---------|
| `analysis_plan_create` | Create new analysis plan |
| `analysis_plan_add_step` | Add step to plan |
| `analysis_plan_update_step` | Update step status |
| `analysis_plan_get` | Get plan details |
| `analysis_step_log` | Log decisions |
| `analysis_checkpoint` | Create QC checkpoints |

#### Phase 5: Publication
| Tool | Purpose |
|------|---------|
| `publication_init` | Start publication prep |
| `publication_generate_methods` | Generate methods from analysis |
| `publication_add_figure` | Track figure specifications |
| `publication_update_figure` | Update figure status |
| `publication_recommend_figures` | Get figure suggestions |
| `publication_get_status` | View publication status |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  pi-galaxy-analyst                       │
│  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │    Extensions    │  │          Skills            │  │
│  │ - state.ts       │  │ - analysis-plan            │  │
│  │ - tools.ts       │  │ - data-acquisition         │  │
│  │ - types.ts       │  │ - rnaseq-analysis          │  │
│  │ - context.ts     │  │ - data-assessment          │  │
│  │ - notebook-*.ts  │  │ - result-review            │  │
│  └──────────────────┘  │ - publication-prep         │  │
│            │           └────────────────────────────┘  │
│    ┌───────┴───────┐                                   │
│    │ Notebook      │ (persistent markdown files)       │
│    │ System        │                                   │
│    └───────────────┘                                   │
└────────────┬───────────────────────────────────────────┘
             │ pi-mcp-adapter
             ▼
      ┌─────────────┐
      │ galaxy-mcp  │
      └──────┬──────┘
             ▼
      ┌─────────────┐
      │   Galaxy    │
      │ (6000+ tools)│
      └─────────────┘
```

## Example Session

```
You: I want to analyze some RNA-seq data from GEO

Pi: I'd be happy to help! Let me start by understanding your research question.

    What biological question are you investigating? What do you hope to learn
    from this dataset?

You: I want to see if drug X affects inflammatory gene expression in cancer cells

Pi: Got it. Let me refine that into a testable hypothesis...
    [Uses research_question_refine with PICO framework]

    Hypothesis: "Drug X treatment causes differential expression of inflammatory
    pathway genes in cancer cell lines"

    Now, what GEO dataset are you working with?

You: GSE164073

Pi: I'll set up the data provenance tracking and import the data...
    [Uses data_set_source, data_add_sample, Galaxy MCP to import]

    Data imported. I've created a samplesheet with 6 samples (3 treated, 3 control).
    Ready to create the analysis plan?

You: Yes, let's do RNA-seq DE analysis

Pi: [Creates structured plan with QC → Alignment → Quantification → DE steps]
    [Works through each step with researcher approval]
    [Documents all decisions in notebook]

    Analysis complete. Key finding: 847 DE genes (FDR<0.05), strong enrichment
    for inflammatory response pathways.

    Ready to prepare publication materials?

You: Yes

Pi: [Transitions to publication phase]
    [Generates methods section from tool versions]
    [Recommends figures: PCA, volcano plot, pathway enrichment]
    [Tracks figure generation in Galaxy]
```

## Notebook System

All analysis state is persisted to markdown notebook files:

```markdown
---
plan_id: "abc123"
title: "Drug X RNA-seq Analysis"
status: active
phase: analysis
---

# Drug X RNA-seq Analysis

**Current Phase**: Analysis

## Research Context
**Research Question**: Does drug X affect inflammatory gene expression?
**Hypothesis**: Drug X treatment causes differential expression of inflammatory genes

## Data Provenance
**Source**: GEO
**Accession**: GSE164073

| ID | Name | Condition |
|----|------|-----------|
| SRR1 | Sample1 | treated |
...

## Analysis Plan
### Step 1: Quality Control
[YAML block with status, inputs, outputs]
...

## Execution Log
[Complete audit trail of all decisions]

## Galaxy References
[Links to Galaxy datasets and history]

## Publication Materials
[Methods draft, figure tracking]
```

Notebooks can be:
- Opened in any text editor or GitHub
- Used to resume analysis across sessions
- Shared with collaborators for review
- Used to reproduce the analysis

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

## Related Projects

- [galaxy-mcp](https://github.com/galaxyproject/galaxy-mcp) - MCP server for Galaxy
- [galaxy-skills](https://github.com/galaxyproject/galaxy-skills) - Skills for Galaxy development
- [Pi coding agent](https://github.com/badlogic/pi-mono) - The Pi.dev agent framework
