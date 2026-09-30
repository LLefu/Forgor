import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  define: { __DEV_VAULT__: JSON.stringify("") },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
