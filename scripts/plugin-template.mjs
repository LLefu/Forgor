// Generates a project from the "Create plugin project" template (src/features/plugins/template)
// into .plugin-template-check/, then type-checks, builds and zips it. Part of `npm run e2e`,
// which installs the zip, so a template that no longer builds fails the tests.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
// The same function the app uses (TypeScript without imports: Node runs it with type stripping).
const { projectFiles } = await import(pathToFileURL(path.join(root, "src/features/plugins/template/project.ts")).href);
const filesDir = path.join(root, "src/features/plugins/template/files");
const templates = {};
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".tpl")) templates[path.relative(filesDir, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
  }
};
walk(filesDir);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const files = projectFiles(
  { id: "template-check", name: "Template check", author: "Forgor", description: "A project made from the plugin template.", appVersion: pkg.version },
  {
    templates,
    types: fs.readFileSync(path.join(root, "packages/plugin-api/index.d.ts"), "utf8"),
    theme: fs.readFileSync(path.join(root, "packages/plugin-api/theme.css"), "utf8"),
    versions: { ...pkg.dependencies, ...pkg.devDependencies },
  },
);
// Inside the repo, so its tools resolve from the repo's node_modules (no npm install needed).
const out = path.join(root, ".plugin-template-check");
fs.rmSync(out, { recursive: true, force: true });
for (const [file, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), text);
}
const run = (...args) => execFileSync(process.execPath, args, { cwd: out, stdio: "inherit" });
run(path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json");
run(path.join(root, "node_modules/vite/bin/vite.js"), "build", "--logLevel", "warn");
run("scripts/zip.mjs");
