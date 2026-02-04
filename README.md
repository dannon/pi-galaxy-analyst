# Pi-Galaxy-Analyst

A [Pi.dev](https://pi.dev) package that transforms Pi into a Galaxy-focused co-scientist agent for bioinformatics analysis.

## What It Does

Pi-Galaxy-Analyst provides **plan-based analysis** — a structured approach to bioinformatics workflows where the agent:

1. **Understands** your research question and data
2. **Creates** a structured analysis plan
3. **Executes** steps using Galaxy tools and workflows
4. **Validates** results at QC checkpoints
5. **Documents** every decision and observation
6. **Iterates** based on findings

The agent works WITH you, not FOR you — you make the decisions, it helps execute them rigorously.

## Installation

### Prerequisites

1. [Pi coding agent](https://github.com/badlogic/pi-mono) installed
2. [pi-mcp-adapter](https://www.npmjs.com/package/pi-mcp-adapter) for Galaxy MCP connection
3. [galaxy-mcp](https://github.com/galaxyproject/galaxy-mcp) server running

### Install the Package

```bash
# Install pi-galaxy-analyst
pi install git:github.com/galaxyproject/pi-galaxy-analyst

# Optionally install galaxy-skills for reference documentation
pi install git:github.com/galaxyproject/galaxy-skills
```

### Configure Galaxy MCP

Add to `~/.pi/agent/mcp.json`:

```json
{
  "mcpServers": {
    "galaxy": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/galaxy-mcp", "galaxy-mcp"],
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

Set your Galaxy credentials:
```bash
export GALAXY_URL="https://usegalaxy.org"
export GALAXY_API_KEY="your-api-key"
```

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
| `/plan` | View current analysis plan summary |
| `/plan-decisions` | View recent decisions in the analysis |

### Skills Provided

| Skill | When Used |
|-------|-----------|
| `analysis-plan` | Starting any new analysis, creating structured plans |
| `rnaseq-analysis` | RNA-seq differential expression workflows |
| `data-assessment` | Inspecting and validating data |
| `result-review` | Interpreting and summarizing results |

### Custom Tools

The extension registers these tools for plan management:

| Tool | Purpose |
|------|---------|
| `analysis_plan_create` | Create new analysis plan |
| `analysis_plan_add_step` | Add step to plan |
| `analysis_plan_update_step` | Update step status |
| `analysis_plan_get` | Get plan details |
| `analysis_step_log` | Log decisions |
| `analysis_checkpoint` | Create QC checkpoints |

## Architecture

```
┌─────────────────────────────────────────┐
│           pi-galaxy-analyst             │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ Extensions  │  │     Skills      │  │
│  │ - state     │  │ - analysis-plan │  │
│  │ - tools     │  │ - rnaseq        │  │
│  │ - context   │  │ - data-assess   │  │
│  └─────────────┘  └─────────────────┘  │
│            │                            │
│    ┌───────┴───────┐                   │
│    │ galaxy-skills │ (knowledge ref)   │
│    └───────────────┘                   │
└────────────┬────────────────────────────┘
             │ pi-mcp-adapter
             ▼
      ┌─────────────┐
      │ galaxy-mcp  │
      └──────┬──────┘
             ▼
      ┌─────────────┐
      │   Galaxy    │
      └─────────────┘
```

## Example Session

```
You: I want to analyze some RNA-seq data

Pi: I'd be happy to help you set up an RNA-seq analysis. Let me ask a few questions first:

1. What's your research question - what are you trying to learn from this data?
2. What data do you have? (Number of samples, conditions, paired/single-end?)
3. What organism and which reference genome should we use?
4. What's your comparison design (e.g., treatment vs control)?

You: I'm studying gene expression changes after drug treatment in human cells.
     I have 6 samples - 3 treated, 3 DMSO control. Paired-end, 150bp.
     Human, GRCh38. Want to find genes changed by the drug.

Pi: Got it. Let me create an analysis plan...

[Creates plan with steps: QC → Trimming → Alignment → Quantification → DE Analysis]

Here's the proposed plan. Should I walk through each step, or does this look good to proceed?

You: Looks good, let's start

Pi: [Activates plan, begins Step 1]
    Starting Step 1: Raw Read Quality Assessment

    I'll run FastQC on your FASTQ files. First, let me connect to Galaxy and
    upload your data...
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

## Related Projects

- [galaxy-mcp](https://github.com/galaxyproject/galaxy-mcp) - MCP server for Galaxy
- [galaxy-skills](https://github.com/galaxyproject/galaxy-skills) - Skills for Galaxy development
- [Pi coding agent](https://github.com/badlogic/pi-mono) - The Pi.dev agent framework
