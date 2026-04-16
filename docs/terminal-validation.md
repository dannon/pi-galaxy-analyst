# Terminal Validation

This runbook keeps loom validation focused on the non-Electron product path.

## Goal

Validate the CLI/runtime experience directly:

- no Electron shell required
- notebook creation and resume work in a normal directory
- Galaxy connection and history state show up in `/status`
- provenance and analysis state persist to the markdown notebook

## 1. Local Checks

From the repo root:

```bash
npm run typecheck
npm test
npm run validate:provenance
```

Expected:

- typecheck passes
- full test suite passes
- provenance sync regression passes

## 2. Extension-Only Runtime Check

Load the extension directly into Pi:

```bash
pi --no-extensions -e /Users/dannon/work/pi-galaxy-analyst/extensions/galaxy-analyst
```

Check:

- `/status`
- `/plan`
- `/connect`
- `/notebook`
- `/profiles`

This isolates extension behavior from the loom wrapper.

## 3. Wrapper Check

Use a clean working directory:

```bash
mkdir -p /tmp/loom-cli-validation
cd /tmp/loom-cli-validation
node /Users/dannon/work/pi-galaxy-analyst/bin/loom.js --provider litellm --model gpt-oss-120b
```

Notes:

- `loom` writes Galaxy MCP configuration into `~/.pi/agent/mcp.json` during startup
- use the wrapper path when you want to validate the real end-user terminal experience
- informational wrapper commands are side-effect free:
  `loom --help`, `loom --version`, and `loom --list-models` should not rewrite MCP config

Check:

- startup completes
- Galaxy auto-connect or `/connect` works
- `/status` reflects connection state

## 4. Notebook Creation and Resume

In the same directory:

1. Ask for a simple analysis plan
2. Confirm a notebook file is created
3. Exit
4. Restart `loom` in the same directory

Expected:

- the notebook auto-loads
- the session resumes existing state instead of starting empty

## 5. Minimal Galaxy Flow

Run the smallest practical terminal-only workflow:

1. create the analysis plan
2. set the data source
3. add sample/file provenance
4. create a Galaxy history
5. add and run a FastQC step
6. log a decision and QC checkpoint

Expected:

- `/status` shows Galaxy history state
- the notebook contains the provenance section, plan state, and Galaxy IDs where applicable

## 6. Current Caveat

As of April 2, 2026:

- the terminal/runtime path itself is working
- the remaining live blocker is model quality for tool calling
- `litellm/gpt-oss-120b` is not reliable enough for smooth multi-step live validation

If a stronger tool-calling model is available, use it for this runbook.
