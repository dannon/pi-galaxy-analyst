# gxypi

An AI co-scientist for [Galaxy](https://galaxyproject.org) bioinformatics, built on [Pi.dev](https://pi.dev).

gxypi turns Pi into a structured analysis partner — it creates plans, runs Galaxy tools, documents every decision, and saves everything to a persistent notebook you can share, resume, and reproduce.

## Install

```bash
npm install -g gxypi
```

Or run without installing:

```bash
npx gxypi
```

You'll also need [uv](https://docs.astral.sh/uv/) for the Galaxy MCP server (installed automatically via `uvx`). If you don't have it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Usage

```
$ gxypi

You: I have RNA-seq data from a drug treatment experiment — 6 samples,
     3 treated and 3 control HeLa cells. I want to find differentially
     expressed genes. The data is at GEO accession GSE164073.

Pi:  I'll help you set up a structured analysis. Let me start by refining
     the research question.

     Research Question: "Does drug X treatment alter gene expression
     in HeLa cells, specifically in inflammatory response pathways?"

     I've created an analysis plan and saved it to:
     📓 rna-seq-drug-treatment-notebook.md

     The plan has 5 steps:
       1. ⬜ Quality Control (FastQC + MultiQC)
       2. ⬜ Read Trimming (Cutadapt)
       3. ⬜ Alignment (HISAT2 to hg38)
       4. ⬜ Quantification (featureCounts)
       5. ⬜ Differential Expression (DESeq2)

     Ready to start with QC?

You: Yes, run FastQC on all samples.

Pi:  Running FastQC via Galaxy...

     ✅ FastQC complete. Results:
     - All samples: Q30 > 88%
     - Adapter content detected in samples 2 and 5
     - Recommendation: proceed with trimming

     I've logged this as a QC checkpoint. Move on to trimming?
```

The next day, come back to the same directory and everything picks up where you left off:

```
$ gxypi

Pi:  Loaded notebook: RNA-seq Drug Treatment (1/5 steps completed)

     Last session completed Quality Control (passed).
     Next step: Read Trimming with Cutadapt.

     Ready to continue?
```

### Configuration

gxypi uses a single config file at `~/.gxypi/config.json` for both Galaxy credentials and LLM provider settings:

```json
{
  "llm": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-5-20250929"
  },
  "galaxy": {
    "active": "usegalaxy-org",
    "profiles": {
      "usegalaxy-org": {
        "url": "https://usegalaxy.org",
        "apiKey": "abc123"
      }
    }
  }
}
```

Both sections are optional. If `llm` is missing, gxypi falls back to environment variables or OAuth login. If `galaxy` is missing, use `/connect` to add a server interactively — credentials are saved to the config file automatically.

You can also set environment variables directly:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export GALAXY_URL="https://usegalaxy.org"
export GALAXY_API_KEY="your-api-key"
```

If you have an existing setup with `~/.pi/agent/galaxy-profiles.json` or `~/.pi/agent/models.json`, gxypi migrates them into `~/.gxypi/config.json` on first run.

### Commands

| Command | What it does |
|---------|-------------|
| `/status` | Galaxy connection state, current plan progress |
| `/plan` | View analysis plan with step status |
| `/plan-decisions` | View the decision log |
| `/notebook` | Notebook info or list available notebooks |
| `/connect` | Connect to a Galaxy server (prompts for credentials) |
| `/profiles` | List saved Galaxy server profiles |

## How It Works

gxypi guides analyses through five phases:

**1. Problem Definition** — Refine your research question using the PICO framework, add literature references.

**2. Data Acquisition** — Track data sources (GEO, SRA, local files), register samples, generate samplesheets, link to Galaxy datasets.

**3. Analysis** — Create a step-by-step plan, execute tools/workflows via Galaxy, log every decision, record QC checkpoints with pass/fail criteria.

**4. Interpretation** — Review results in biological context, pathway analysis.

**5. Publication** — Generate methods sections from the tool versions actually used, track figures, prepare data sharing.

Everything is saved to a **notebook file** — a readable markdown document with YAML blocks for structured data. You can open it in any editor, share it with collaborators, or use it to reproduce the analysis later.

### Git-tracked notebooks

When gxypi creates a notebook, it initializes a git repository in the working directory (if one doesn't already exist) and commits every meaningful change as it happens. Step completions, QC checkpoints, decisions, phase transitions — each gets its own commit with a descriptive message like `Add step: Read Mapping` or `QC: Post-alignment QC (passed)`.

This gives you a few things for free:

- **Full undo history.** If an analysis step goes sideways, `git log` shows exactly what changed and when. You can diff any two points in the analysis or revert a bad step.
- **Reproducibility evidence.** The commit history is a timestamped, immutable record of every decision and result. Reviewers and collaborators can see not just the final notebook but the entire sequence of how you got there.
- **Branch-based exploration.** Want to try an alternative DE threshold or a different aligner? Branch, run the variant, and compare notebooks side by side with `git diff`.
- **Collaboration.** Push the repo to GitHub and collaborators can pull, review the analysis history, and continue where you left off.

The `.gitignore` auto-created with the repo excludes large bioinformatics files (FASTQ, BAM, VCF, etc.) so only the notebook markdown and any small analysis artifacts get tracked.

Granular changes like Galaxy dataset references and literature additions are bundled into the next structural commit rather than creating their own, keeping the history clean.

## Using Local LLMs

Pi supports any OpenAI-compatible API. To use a local provider like [LiteLLM](https://litellm.ai/), set it in `~/.gxypi/config.json`:

```json
{
  "llm": {
    "provider": "litellm",
    "apiKey": "your-key",
    "model": "your-model-name"
  }
}
```

You'll also need a `~/.pi/agent/models.json` to tell Pi the model's capabilities (context window, token limits, etc.) — see the Pi documentation for the format. The config file handles provider selection and API keys; `models.json` handles the model metadata that Pi needs for request sizing.

Alternatively, pass flags directly: `gxypi --provider litellm --model your-model-name`.

## Tool Reference

gxypi registers tools across the analysis lifecycle:

| Category | Tools |
|----------|-------|
| **Phase management** | `analysis_set_phase` |
| **Problem definition** | `research_question_refine`, `research_add_literature` |
| **Data acquisition** | `data_set_source`, `data_add_sample`, `data_add_file`, `data_link_galaxy`, `data_generate_samplesheet`, `data_get_provenance` |
| **Analysis** | `analysis_plan_create`, `analysis_plan_add_step`, `analysis_plan_update_step`, `analysis_plan_get`, `analysis_plan_activate`, `analysis_plan_summary`, `analysis_step_log`, `analysis_checkpoint` |
| **Notebooks** | `analysis_notebook_create`, `analysis_notebook_open`, `analysis_notebook_list` |
| **Publication** | `publication_init`, `publication_generate_methods`, `publication_add_figure`, `publication_update_figure`, `publication_recommend_figures`, `publication_get_status` |
| **GTN tutorials** | `gtn_search`, `gtn_fetch` |

## Related Projects

- [Galaxy](https://galaxyproject.org) — Open-source platform for data-intensive biomedical research
- [galaxy-mcp](https://github.com/galaxyproject/galaxy-mcp) — MCP server for the Galaxy API
- [Pi coding agent](https://github.com/badlogic/pi-mono) — The Pi.dev agent framework

## License

MIT
