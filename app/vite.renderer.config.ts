import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: false,
    // HMR disabled: after a macOS display sleep, Vite's HMR client detects a
    // dropped WebSocket and unconditionally calls location.reload(), wiping
    // all renderer state (chat, plan, steps, results) while the agent
    // subprocess keeps running. location.reload is [LegacyUnforgeable], so
    // patching it fails. Disabling HMR removes the WebSocket entirely.
    hmr: false,
  },
});
