import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "test-results", "playwright-report"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Native dialogs don't work in the macOS webview; use confirmDialog() from components/ConfirmDialog.
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use confirmDialog() (native confirm is unsupported on macOS)." },
        { name: "alert", message: "Native alert is unsupported on macOS." },
        { name: "prompt", message: "Native prompt is unsupported on macOS." },
      ],
    },
  },
);
