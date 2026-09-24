import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run the real UI in Chromium against the in-memory
 * platform (sql.js + in-memory vault), the same code paths as the desktop
 * app minus the Tauri file system.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:1430",
    viewport: { width: 1400, height: 880 },
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --port 1430 --strictPort",
    url: "http://localhost:1430",
    reuseExistingServer: true,
  },
});
