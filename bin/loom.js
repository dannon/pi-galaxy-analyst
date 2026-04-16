#!/usr/bin/env node

import { main } from "@mariozechner/pi-coding-agent";
import { resolve, dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Loom is a standalone product — suppress Pi's own update notifications
process.env.PI_SKIP_VERSION_CHECK = "1";

// Resolve extension paths relative to this script
const extensionPath = resolve(__dirname, "../extensions/galaxy-analyst");

// pi-mcp-adapter is what teaches Pi how to use MCP servers from mcp.json
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const mcpAdapterPath = dirname(require.resolve("pi-mcp-adapter/index.ts"));
const piEntryPointPath = fileURLToPath(import.meta.resolve("@mariozechner/pi-coding-agent"));
const piPackageDir = dirname(dirname(piEntryPointPath));
const piArgsModulePath = join(piPackageDir, "dist/cli/args.js");
const piListModelsModulePath = join(piPackageDir, "dist/cli/list-models.js");
const piConfigModulePath = join(piPackageDir, "dist/config.js");
const piAuthStorageModulePath = join(piPackageDir, "dist/core/auth-storage.js");
const piModelRegistryModulePath = join(piPackageDir, "dist/core/model-registry.js");
const userArgs = process.argv.slice(2);

function hasArg(flag) {
  return userArgs.includes(flag) || userArgs.some(arg => arg.startsWith(`${flag}=`));
}

const isInformationalCommand = [
  "--help",
  "-h",
  "--version",
  "--list-models",
].some(hasArg);

function getListModelsSearchPattern() {
  const index = userArgs.findIndex(arg => arg === "--list-models");
  if (index === -1) return undefined;
  const candidate = userArgs[index + 1];
  if (!candidate || candidate.startsWith("-") || candidate.startsWith("@")) {
    return undefined;
  }
  return candidate;
}

async function handleInformationalCommand() {
  if (hasArg("--help") || hasArg("-h")) {
    const { printHelp } = await import(pathToFileURL(piArgsModulePath).href);
    printHelp();
    return true;
  }

  if (hasArg("--version")) {
    const { VERSION } = await import(pathToFileURL(piConfigModulePath).href);
    console.log(VERSION);
    return true;
  }

  if (hasArg("--list-models")) {
    const { listModels } = await import(pathToFileURL(piListModelsModulePath).href);
    const { getModelsPath } = await import(pathToFileURL(piConfigModulePath).href);
    const { AuthStorage } = await import(pathToFileURL(piAuthStorageModulePath).href);
    const { ModelRegistry } = await import(pathToFileURL(piModelRegistryModulePath).href);
    const authStorage = AuthStorage.inMemory();
    const modelRegistry = new ModelRegistry(authStorage, getModelsPath());
    await listModels(modelRegistry, getListModelsSearchPattern());
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loom brain-level config (~/.loom/config.json)
//
// Shared by every consumer (loom CLI, Orbit, future shells). The CLI only
// reads/writes it; it doesn't own the schema. Shell-specific state lives in
// each shell's own dir.
// ─────────────────────────────────────────────────────────────────────────────

const loomConfigDir = join(homedir(), ".loom");
const loomConfigPath = join(loomConfigDir, "config.json");

// Legacy path kept for one-shot migration.
const legacyGxypiConfigPath = join(homedir(), ".gxypi", "config.json");

function loadLoomConfig() {
  if (existsSync(loomConfigPath)) {
    try {
      return JSON.parse(readFileSync(loomConfigPath, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveLoomConfig(config) {
  mkdirSync(loomConfigDir, { recursive: true });
  writeFileSync(loomConfigPath, JSON.stringify(config, null, 2) + "\n");
}

// One-shot migration: copy ~/.gxypi/config.json to ~/.loom/config.json.
// Runs before any other legacy migration so the canonical path is populated
// before we look at ~/.pi/agent/ legacy files.
function migrateFromGxypi() {
  if (existsSync(loomConfigPath)) return;
  if (!existsSync(legacyGxypiConfigPath)) return;
  try {
    const legacy = JSON.parse(readFileSync(legacyGxypiConfigPath, "utf-8"));
    mkdirSync(loomConfigDir, { recursive: true });
    writeFileSync(loomConfigPath, JSON.stringify(legacy, null, 2) + "\n");
  } catch {
    // Corrupt legacy file; ignore and let the ~/.pi migration try its thing.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy migration: pull galaxy-profiles.json and models.json into config.json
// ─────────────────────────────────────────────────────────────────────────────

const agentDir = process.env.PI_CODING_AGENT_DIR
  || join(homedir(), ".pi", "agent");

function migrateLegacyFiles() {
  if (existsSync(loomConfigPath)) return;

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
    saveLoomConfig(config);
  }
}

if (!isInformationalCommand) {
  migrateFromGxypi();
  migrateLegacyFiles();
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply consolidated config
// ─────────────────────────────────────────────────────────────────────────────

const loomConfig = loadLoomConfig();

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
if (loomConfig.llm?.apiKey) {
  const provider = loomConfig.llm.provider || "anthropic";
  const envVar = PROVIDER_ENV_MAP[provider] || "AI_GATEWAY_API_KEY";
  if (!process.env[envVar]) {
    process.env[envVar] = loomConfig.llm.apiKey;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configure Galaxy MCP based on executionMode
//
// Remote (default): register the Galaxy MCP server so the LLM can call
// Galaxy tools directly. Reproducibility + large-scale compute lives here.
// Local: strip Galaxy MCP entirely. The LLM has no Galaxy tools available,
// only local run_command / plan management / notebook updates. This is what
// the "Local" toggle in Orbit's masthead actually flips.
// ─────────────────────────────────────────────────────────────────────────────

const executionMode = loomConfig.executionMode || "remote";
const mcpConfigPath = join(agentDir, "mcp.json");

let mcpConfig = {};
if (!isInformationalCommand) {
  if (existsSync(mcpConfigPath)) {
    mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
  }

  mcpConfig.mcpServers = mcpConfig.mcpServers || {};

  if (executionMode === "remote") {
    if (!mcpConfig.mcpServers.galaxy) {
      mcpConfig.mcpServers.galaxy = {
        command: "uvx",
        args: ["galaxy-mcp"],
      };
    }
    // Expose Galaxy tools as direct (first-class) tools so the LLM can call
    // them by name instead of going through the mcp() proxy gateway.
    if (!mcpConfig.mcpServers.galaxy.directTools) {
      mcpConfig.mcpServers.galaxy.directTools = true;
    }
  } else {
    // Local mode: tear down Galaxy MCP if it was previously registered.
    delete mcpConfig.mcpServers.galaxy;
  }

  mkdirSync(dirname(mcpConfigPath), { recursive: true });
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Load Galaxy credentials: consolidated config → legacy profiles → mcp.json
// ─────────────────────────────────────────────────────────────────────────────

let galaxyLoaded = false;

// 1. Consolidated config
if (!isInformationalCommand && loomConfig.galaxy?.active && loomConfig.galaxy.profiles) {
  const active = loomConfig.galaxy.profiles[loomConfig.galaxy.active];
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
if (!isInformationalCommand && !galaxyLoaded) {
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
  const skipFlags = ["--version", "--help", "-h", "--api-key", "--list-models"];
  if (userArgs.some(a => skipFlags.some(f => a.startsWith(f)))) return;
  if (hasArg("--provider")) return;

  // Consolidated config has an API key
  if (loomConfig.llm?.apiKey) return;

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

  console.error(`loom requires an LLM provider to function.

Set up one of the following:

  1. Config file (recommended):
     Create ~/.loom/config.json:
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
     See: https://github.com/galaxyproject/pi-galaxy-analyst#local-llms

  4. OAuth login:
     Run with --provider anthropic (or openai, google, etc.)
     and follow the login prompts.
`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inject --provider / --model from consolidated config or legacy models.json
// ─────────────────────────────────────────────────────────────────────────────

const providerArgs = [];
if (!hasArg("--provider")) {
  // Prefer consolidated config
  if (loomConfig.llm?.provider) {
    providerArgs.push("--provider", loomConfig.llm.provider);
    if (loomConfig.llm.model && !userArgs.includes("--model") && !userArgs.some(a => a.startsWith("--model="))) {
      providerArgs.push("--model", loomConfig.llm.model);
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

if (await handleInformationalCommand()) {
  process.exit(0);
}

checkLLMProvider();
main(args);
