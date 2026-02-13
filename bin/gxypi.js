#!/usr/bin/env node

import { main } from "@mariozechner/pi-coding-agent";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// gxypi is a standalone product — suppress Pi's own update notifications
process.env.PI_SKIP_VERSION_CHECK = "1";

// Resolve extension paths relative to this script
const extensionPath = resolve(__dirname, "../extensions/galaxy-analyst");

// pi-mcp-adapter is what teaches Pi how to use MCP servers from mcp.json
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mcpAdapterPath = dirname(require.resolve("pi-mcp-adapter/index.ts"));

// ─────────────────────────────────────────────────────────────────────────────
// Consolidated config (~/.gxypi/config.json)
// ─────────────────────────────────────────────────────────────────────────────

const gxypiConfigDir = join(homedir(), ".gxypi");
const gxypiConfigPath = join(gxypiConfigDir, "config.json");

function loadGxypiConfig() {
  if (existsSync(gxypiConfigPath)) {
    try {
      return JSON.parse(readFileSync(gxypiConfigPath, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveGxypiConfig(config) {
  mkdirSync(gxypiConfigDir, { recursive: true });
  writeFileSync(gxypiConfigPath, JSON.stringify(config, null, 2) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy migration: pull galaxy-profiles.json and models.json into config.json
// ─────────────────────────────────────────────────────────────────────────────

const agentDir = process.env.PI_CODING_AGENT_DIR
  || join(homedir(), ".pi", "agent");

function migrateLegacyFiles() {
  if (existsSync(gxypiConfigPath)) return;

  let config = {};
  let migrated = false;

  // Migrate galaxy-profiles.json → config.galaxy
  const legacyProfilesPath = join(agentDir, "galaxy-profiles.json");
  if (existsSync(legacyProfilesPath)) {
    try {
      const data = JSON.parse(readFileSync(legacyProfilesPath, "utf-8"));
      if (data.profiles && Object.keys(data.profiles).length > 0) {
        config.galaxy = {
          active: data.active ?? null,
          profiles: data.profiles,
        };
        migrated = true;
      }
    } catch {}
  }

  // Migrate models.json → config.llm
  const legacyModelsPath = join(agentDir, "models.json");
  if (existsSync(legacyModelsPath)) {
    try {
      const models = JSON.parse(readFileSync(legacyModelsPath, "utf-8"));
      const providers = models.providers || {};
      const [providerName, providerConfig] = Object.entries(providers)[0] || [];
      if (providerName && providerConfig?.apiKey) {
        config.llm = {
          provider: providerName,
          apiKey: providerConfig.apiKey,
        };
        if (providerConfig.models?.length) {
          config.llm.model = providerConfig.models[0].id;
        }
        migrated = true;
      }
    } catch {}
  }

  if (migrated) {
    saveGxypiConfig(config);
  }
}

migrateLegacyFiles();

// ─────────────────────────────────────────────────────────────────────────────
// Apply consolidated config
// ─────────────────────────────────────────────────────────────────────────────

const gxypiConfig = loadGxypiConfig();

// Provider name → env var mapping
const PROVIDER_ENV_MAP = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
};

// LLM config: set env var if not already present
if (gxypiConfig.llm?.apiKey) {
  const provider = gxypiConfig.llm.provider || "anthropic";
  const envVar = PROVIDER_ENV_MAP[provider] || "AI_GATEWAY_API_KEY";
  if (!process.env[envVar]) {
    process.env[envVar] = gxypiConfig.llm.apiKey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensure Galaxy MCP is configured before Pi starts
// ─────────────────────────────────────────────────────────────────────────────

const mcpConfigPath = join(agentDir, "mcp.json");

let mcpConfig = {};
if (existsSync(mcpConfigPath)) {
  mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
}

mcpConfig.mcpServers = mcpConfig.mcpServers || {};
if (!mcpConfig.mcpServers.galaxy) {
  mcpConfig.mcpServers.galaxy = {
    command: "uvx",
    args: ["galaxy-mcp"],
  };
}
// Expose Galaxy tools as direct (first-class) tools so the LLM can call them
// by name instead of going through the mcp() proxy gateway
if (!mcpConfig.mcpServers.galaxy.directTools) {
  mcpConfig.mcpServers.galaxy.directTools = true;
}
mkdirSync(dirname(mcpConfigPath), { recursive: true });
writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

// ─────────────────────────────────────────────────────────────────────────────
// Load Galaxy credentials: consolidated config → legacy profiles → mcp.json
// ─────────────────────────────────────────────────────────────────────────────

let galaxyLoaded = false;

// 1. Consolidated config
if (gxypiConfig.galaxy?.active && gxypiConfig.galaxy.profiles) {
  const active = gxypiConfig.galaxy.profiles[gxypiConfig.galaxy.active];
  if (active) {
    if (!process.env.GALAXY_URL) process.env.GALAXY_URL = active.url;
    if (!process.env.GALAXY_API_KEY) process.env.GALAXY_API_KEY = active.apiKey;

    if (mcpConfig.mcpServers?.galaxy) {
      mcpConfig.mcpServers.galaxy.env = {
        GALAXY_URL: active.url,
        GALAXY_API_KEY: active.apiKey,
      };
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    }
    galaxyLoaded = true;
  }
}

// 2. Legacy galaxy-profiles.json (for setups that haven't migrated yet)
if (!galaxyLoaded) {
  const profilesPath = join(agentDir, "galaxy-profiles.json");

  if (!existsSync(profilesPath)) {
    // One-time migration: if mcp.json has Galaxy credentials, create a profile from them
    const galaxyEnv = mcpConfig.mcpServers?.galaxy?.env;
    if (galaxyEnv?.GALAXY_URL && galaxyEnv?.GALAXY_API_KEY) {
      const url = galaxyEnv.GALAXY_URL;
      const apiKey = galaxyEnv.GALAXY_API_KEY;
      let profileName;
      try {
        const parsed = new URL(url);
        profileName = parsed.hostname.replace(/\./g, "-");
        if (parsed.port) profileName += `-${parsed.port}`;
      } catch {
        profileName = "default";
      }
      const profiles = {
        active: profileName,
        profiles: { [profileName]: { url, apiKey } },
      };
      mkdirSync(dirname(profilesPath), { recursive: true });
      writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
    }
  }

  if (existsSync(profilesPath)) {
    try {
      const profiles = JSON.parse(readFileSync(profilesPath, "utf-8"));
      const active = profiles.profiles?.[profiles.active];
      if (active) {
        if (!process.env.GALAXY_URL) process.env.GALAXY_URL = active.url;
        if (!process.env.GALAXY_API_KEY) process.env.GALAXY_API_KEY = active.apiKey;

        if (mcpConfig.mcpServers?.galaxy) {
          mcpConfig.mcpServers.galaxy.env = {
            GALAXY_URL: active.url,
            GALAXY_API_KEY: active.apiKey,
          };
          writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
        }
      }
    } catch {
      // Profiles file is corrupt — fall through, /connect still works
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight: ensure at least one LLM provider is configured
// ─────────────────────────────────────────────────────────────────────────────

function checkLLMProvider() {
  const argv = process.argv.slice(2);
  const skipFlags = ["--version", "--help", "-h", "--api-key"];
  if (argv.some(a => skipFlags.some(f => a.startsWith(f)))) return;
  if (argv.includes("--provider")) return;

  // Consolidated config has an API key
  if (gxypiConfig.llm?.apiKey) return;

  const providerEnvVars = [
    "ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN",
    "OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY",
    "MISTRAL_API_KEY", "XAI_API_KEY", "OPENROUTER_API_KEY",
    "CEREBRAS_API_KEY", "AI_GATEWAY_API_KEY", "HF_TOKEN",
    "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "GOOGLE_CLOUD_PROJECT",
    "AZURE_OPENAI_API_KEY", "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN",
  ];
  if (providerEnvVars.some(v => process.env[v])) return;

  const authPath = join(agentDir, "auth.json");
  if (existsSync(authPath)) {
    try {
      const auth = JSON.parse(readFileSync(authPath, "utf-8"));
      if (Object.keys(auth).length > 0) return;
    } catch {}
  }

  const modelsPath = join(agentDir, "models.json");
  if (existsSync(modelsPath)) {
    try {
      const models = JSON.parse(readFileSync(modelsPath, "utf-8"));
      const providers = models.providers || {};
      if (Object.values(providers).some(p => p.apiKey)) return;
    } catch {}
  }

  console.error(`gxypi requires an LLM provider to function.

Set up one of the following:

  1. Config file (recommended):
     Create ~/.gxypi/config.json:
     {
       "llm": {
         "provider": "anthropic",
         "apiKey": "sk-ant-..."
       }
     }

  2. Environment variable:
     export ANTHROPIC_API_KEY=sk-ant-...
     export OPENAI_API_KEY=sk-...

  3. Custom provider (~/.pi/agent/models.json):
     For local/self-hosted models via litellm, ollama, etc.
     See: https://github.com/galaxyproject/gxypi#providers

  4. OAuth login:
     Run with --provider anthropic (or openai, google, etc.)
     and follow the login prompts.
`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inject --provider / --model from consolidated config or legacy models.json
// ─────────────────────────────────────────────────────────────────────────────

const userArgs = process.argv.slice(2);
const providerArgs = [];
if (!userArgs.includes("--provider") && !userArgs.some(a => a.startsWith("--provider="))) {
  // Prefer consolidated config
  if (gxypiConfig.llm?.provider) {
    providerArgs.push("--provider", gxypiConfig.llm.provider);
    if (gxypiConfig.llm.model && !userArgs.includes("--model") && !userArgs.some(a => a.startsWith("--model="))) {
      providerArgs.push("--model", gxypiConfig.llm.model);
    }
  } else {
    // Fall back to legacy models.json
    const modelsPath = join(agentDir, "models.json");
    if (existsSync(modelsPath)) {
      try {
        const models = JSON.parse(readFileSync(modelsPath, "utf-8"));
        const providers = models.providers || {};
        const [providerName, providerConfig] = Object.entries(providers)[0] || [];
        if (providerName && providerConfig?.models?.length) {
          providerArgs.push("--provider", providerName);
          if (!userArgs.includes("--model") && !userArgs.some(a => a.startsWith("--model="))) {
            providerArgs.push("--model", providerConfig.models[0].id);
          }
        }
      } catch {}
    }
  }
}

// Build args: inject both extensions, pass through everything else
const args = ["-e", mcpAdapterPath, "-e", extensionPath, ...providerArgs, ...userArgs];

checkLLMProvider();
main(args);
