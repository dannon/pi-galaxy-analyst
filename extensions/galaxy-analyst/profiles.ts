/**
 * Galaxy server profile management
 *
 * Stores named profiles in the `galaxy` section of ~/.gxypi/config.json.
 * Each profile holds a URL + API key. The active profile's credentials
 * are synced to mcp.json's env block so the Galaxy MCP server sees them.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadConfig, saveConfig } from "./config";

export interface GalaxyProfile {
  url: string;
  apiKey: string;
}

export interface GalaxyProfiles {
  active: string | null;
  profiles: Record<string, GalaxyProfile>;
}

export function loadProfiles(): GalaxyProfiles {
  const config = loadConfig();
  if (config.galaxy) {
    return {
      active: config.galaxy.active ?? null,
      profiles: config.galaxy.profiles ?? {},
    };
  }
  return { active: null, profiles: {} };
}

function writeProfiles(profiles: GalaxyProfiles): void {
  const config = loadConfig();
  config.galaxy = {
    active: profiles.active,
    profiles: profiles.profiles,
  };
  saveConfig(config);
}

/**
 * Derive a short profile name from a Galaxy server URL.
 * https://test.galaxyproject.org/ → "test-galaxyproject"
 * https://usegalaxy.org/ → "usegalaxy-org"
 * http://localhost:8080/ → "localhost-8080"
 */
export function profileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let host = parsed.hostname;
    // Include port for non-standard ports
    if (parsed.port) {
      host += `-${parsed.port}`;
    }
    // Replace dots with hyphens, drop trailing TLD-only segments for cleaner names
    return host.replace(/\./g, "-").replace(/-+$/, "");
  } catch {
    // Fallback: slugify the whole string
    return url.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  }
}

/**
 * Save a profile (insert or update), mark it active, and sync to mcp.json.
 */
export function saveProfile(name: string, url: string, apiKey: string): void {
  const profiles = loadProfiles();
  profiles.profiles[name] = { url, apiKey };
  profiles.active = name;
  writeProfiles(profiles);
  syncMcpConfig(url, apiKey);
}

/**
 * Switch to an existing profile. Updates active marker, syncs mcp.json,
 * and sets process.env so the current session picks it up immediately.
 */
export function switchProfile(name: string): boolean {
  const profiles = loadProfiles();
  const profile = profiles.profiles[name];
  if (!profile) return false;

  profiles.active = name;
  writeProfiles(profiles);

  process.env.GALAXY_URL = profile.url;
  process.env.GALAXY_API_KEY = profile.apiKey;
  syncMcpConfig(profile.url, profile.apiKey);
  return true;
}

/**
 * Remove a profile. If it was active, clears the active marker.
 */
export function deleteProfile(name: string): boolean {
  const profiles = loadProfiles();
  if (!profiles.profiles[name]) return false;

  delete profiles.profiles[name];
  if (profiles.active === name) {
    const remaining = Object.keys(profiles.profiles);
    profiles.active = remaining.length > 0 ? remaining[0] : null;
  }
  writeProfiles(profiles);
  return true;
}

/**
 * Keep mcp.json's galaxy env block in sync with the given credentials.
 */
export function syncMcpConfig(url: string, apiKey: string): void {
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
    const mcpPath = path.join(agentDir, "mcp.json");
    if (!fs.existsSync(mcpPath)) return;

    const config = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    if (config.mcpServers?.galaxy) {
      config.mcpServers.galaxy.env = {
        GALAXY_URL: url,
        GALAXY_API_KEY: apiKey,
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2));
    }
  } catch {
    // Non-fatal
  }
}
