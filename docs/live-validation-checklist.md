# Live Validation Checklist

This checklist is the current manual validation path for `loom`. It is ordered from lowest-risk runtime checks to a minimal real Galaxy workflow.

## Preconditions

- Node.js and npm available
- `uv` or `uvx` available for `galaxy-mcp`
- A working `pi` CLI installed
- Prefer a `pi` CLI version aligned with the SDK used by this repo
- Galaxy API key ready for the target server

## 1. Verify local repo state

From the repo root:

```bash
npm install
npm run typecheck
npm test
pi --version
```

Expected:

- `tsc --noEmit` passes
- test suite passes
- `npm run validate:provenance` passes
- note the `pi` CLI version and compare it to the SDK version in `package.json`

## 2. Load the extension in a clean Pi runtime

```bash
pi --no-extensions -e ./extensions/galaxy-analyst
```

Check:

- startup completes without extension load errors
- `/status` works
- `/plan` works
- `/connect` works
- `/notebook` works
- `/profiles` works

If the runtime exposes a tool listing view, verify the current extension tool set, including:

- interpretation tools
- workflow integration tools
- `brc_set_context`
- `gtn_search` and `gtn_fetch`

These were added after earlier notes that reported only 26 visible tools.

## 3. Validate connection state bridging first

Inside Pi:

1. Run `/connect`
2. Enter a Galaxy URL and API key
3. Ask the agent: `Create a new Galaxy history called "loom validation test"`
4. Run `/status`

Expected:

- Galaxy connects successfully
- the history is created on the server
- `/status` shows both Galaxy connection and current history ID
- no extension errors appear during the `galaxy_connect` or `galaxy_create_history` tool flow

This verifies the extension's event-based state tracking before testing notebook-heavy analysis flows.

Current known-good result:

- extension loads in the real runtime
- `galaxy_connect` succeeds
- `galaxy_create_history` succeeds and `/status` reflects the real history ID

## 4. Create and resume a notebook-backed plan

In an empty test directory:

```bash
mkdir -p /tmp/loom-validation
cd /tmp/loom-validation
pi --no-extensions -e /Users/dannon/work/pi-galaxy-analyst/extensions/galaxy-analyst
```

Prompt:

```text
I want to assess the quality of a small RNA-seq dataset in Galaxy. Create a structured analysis plan.
```

Expected:

- `analysis_plan_create` is called
- a notebook file is created in the working directory
- `/status` shows an active plan
- `/notebook` shows the notebook path

Then exit and restart in the same directory:

```bash
cd /tmp/loom-validation
pi --no-extensions -e /Users/dannon/work/pi-galaxy-analyst/extensions/galaxy-analyst
```

Expected:

- the notebook auto-loads
- the session recap references the existing plan
- `/status` shows the same plan rather than a fresh empty session

Current known-good result:

- in the live wrapper path, `analysis_plan_create` and `data_set_source` now rewrite the notebook correctly
- the `## Data Provenance` section is present on disk after `data_set_source`
- sample/file live retesting still depends on a more reliable tool-calling model than the currently working `litellm/gpt-oss-120b`

## 5. Run the smallest real Galaxy workflow

Use a small public dataset and keep the scope to phases 1-3.

Prompt sequence:

1. `Refine the research question for a simple RNA-seq QC analysis.`
2. `Move to data acquisition and record the dataset source and samples.`
3. `Import the files into Galaxy.`
4. `Add a FastQC step to the plan and run it.`
5. `Log the tool choice and create a QC checkpoint from the results.`

Expected:

- `research_question_refine` is used
- `analysis_set_phase` moves into `data_acquisition`, then `analysis`
- provenance tools record source, samples, and file links
- a plan step is added for FastQC
- Galaxy job output is linked back into notebook state
- a decision entry and QC checkpoint are recorded

Note:

- do not use `litellm/gpt-oss-120b` for this final pass if a stronger tool-calling model is available
- that model is currently the main blocker for completing live provenance/sample/file validation, not the extension code

## 6. Inspect the notebook artifact

Open the generated notebook and verify:

- frontmatter contains plan metadata
- Galaxy history information is present
- analysis steps are present as YAML blocks
- execution log entries exist for decisions and checkpoints
- real Galaxy IDs appear where applicable

## 7. Record the validation result

After the run, update the project status docs with:

- `pi` CLI version used
- Galaxy server used
- whether connection/history tracking worked
- whether notebook auto-resume worked
- whether real dataset/job IDs were captured
- whether the live model was reliable enough to complete tool sequences without manual retrying
- any runtime/API mismatches found

## Known Risk Areas

- SDK/runtime skew between the globally installed `pi` CLI and the SDK version in this repo
- Galaxy MCP configuration differences across Pi versions
- Real Galaxy tool names and IDs varying across servers
- Session resumption only being partially validated unless the restart test is actually run
