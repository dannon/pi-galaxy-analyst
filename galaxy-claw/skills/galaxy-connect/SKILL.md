---
name: galaxy-connect
description: "Connect to a Galaxy bioinformatics server via galaxy-mcp -- authenticate, verify access, and configure the MCP server"
version: 0.2.0
author: Galaxy Project
license: MIT
tags: [galaxy, authentication, bioinformatics, mcp]
metadata:
  openclaw:
    requires:
      bins:
        - uvx
      env:
        - GALAXY_URL
        - GALAXY_API_KEY
    emoji: "🔗"
    trigger_keywords:
      - connect to galaxy
      - galaxy login
      - galaxy server
      - galaxy api key
      - usegalaxy
---

# Galaxy Connect

Connect and authenticate with any Galaxy bioinformatics server using **galaxy-mcp**, the official Galaxy MCP server.

## Prerequisites

Install galaxy-mcp (one command):
```bash
uvx galaxy-mcp
# or: pip install galaxy-mcp
```

## How to Connect

The user needs:
1. **Galaxy server URL** -- e.g. `https://usegalaxy.org`
2. **API key** -- from Galaxy > User > Preferences > Manage API Key

Set environment variables:
```bash
export GALAXY_URL=https://usegalaxy.org
export GALAXY_API_KEY=your-api-key-here
```

The galaxy-mcp server handles all Galaxy API communication. Once configured, the agent can use Galaxy MCP tools directly to search tools, run analyses, manage histories, and execute workflows.

## OpenClaw/NemoClaw Configuration

Add galaxy-mcp to your MCP server config. In `~/.openclaw/openclaw.json`:
```json
{
  "mcpServers": {
    "galaxy": {
      "command": "uvx",
      "args": ["galaxy-mcp"],
      "env": {
        "GALAXY_URL": "https://usegalaxy.org",
        "GALAXY_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Verify Connection

After configuring, ask the agent to call the galaxy-mcp `get_server_info` tool to verify the connection. This returns the Galaxy version, brand, and user information.

## Common Servers

| Server | URL | Notes |
|--------|-----|-------|
| **usegalaxy.org** | `https://usegalaxy.org` | Main US server, largest tool collection |
| **usegalaxy.eu** | `https://usegalaxy.eu` | European server, strong training support |
| **usegalaxy.org.au** | `https://usegalaxy.org.au` | Australian server, supports OAuth login |

## Troubleshooting

- **"Invalid API key"** -- regenerate at Galaxy > User > Preferences > Manage API Key
- **Connection timeout** -- check the URL and network; institutional Galaxies may require VPN
- **"galaxy-mcp not found"** -- install with `pip install galaxy-mcp` or `uvx galaxy-mcp`

## After Connecting

Once connected, the agent has access to Galaxy's full API via MCP tools:
- Search and run tools (see `galaxy-tools` skill)
- Manage histories and datasets (see `galaxy-history` skill)
- Run workflows (see `galaxy-workflow` skill)
- Follow guided pipelines (see `galaxy-rnaseq`, `galaxy-variant`, `galaxy-metagenomics`)
