import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * Builds the plugin the way Forgor loads it: dist/main.js (one CommonJS file
 * that gets React from the app), dist/styles.css and dist/manifest.json.
 * Don't change `formats`, `external` or the file names.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-manifest",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "manifest.json", source: fs.readFileSync(path.resolve("manifest.json"), "utf8") });
      },
    },
  ],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: { entry: path.resolve("src/index.tsx"), formats: ["cjs"], fileName: () => "main.js", cssFileName: "styles" },
    // The app's React: a second copy would break hooks.
    rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime"] },
  },
});
