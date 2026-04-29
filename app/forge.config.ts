import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";

const APP_DIR = __dirname;
const REPO_ROOT = path.resolve(APP_DIR, "..");
const LOOM_STAGE_PARENT = path.resolve(APP_DIR, ".loom-stage");
const LOOM_STAGE_DIR = path.join(LOOM_STAGE_PARENT, "loom");

// Files copied verbatim from the Loom repo root into the staged bundle.
// Mirrors the npm `files` allowlist plus package-lock.json (used by npm ci).
const LOOM_BUNDLE_FILES = [
  "bin",
  "extensions",
  "shared",
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
];

function stageLoomBundle(): void {
  // Wipe + recreate stage so removed files don't linger between runs.
  fs.rmSync(LOOM_STAGE_PARENT, { recursive: true, force: true });
  fs.mkdirSync(LOOM_STAGE_DIR, { recursive: true });

  for (const item of LOOM_BUNDLE_FILES) {
    const src = path.join(REPO_ROOT, item);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(LOOM_STAGE_DIR, item), { recursive: true });
  }

  // Install runtime deps only (no devDependencies) into the staged bundle.
  // npm ci is faster + deterministic when the lockfile is present.
  const installCmd = fs.existsSync(path.join(LOOM_STAGE_DIR, "package-lock.json"))
    ? "npm ci --omit=dev --no-audit --no-fund"
    : "npm install --omit=dev --omit=optional --no-audit --no-fund";
  execSync(installCmd, { cwd: LOOM_STAGE_DIR, stdio: "inherit" });
}

const config: ForgeConfig = {
  packagerConfig: {
    name: "Orbit",
    executableName: "orbit",
    icon: "resources/icon",
    // Copies the staged Loom bundle to Contents/Resources/loom/ in the
    // packaged app. agent.ts resolves process.resourcesPath/loom/bin/loom.js.
    extraResource: [LOOM_STAGE_DIR],
  },
  hooks: {
    prePackage: async () => {
      stageLoomBundle();
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux"],
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO",
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
