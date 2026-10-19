/**
 * A new plugin project's files ("Create plugin project" on the Plugins page):
 * the template in ./files (*.tpl), the plugin API types and theme from
 * packages/plugin-api, and a package.json with the app's own tool versions.
 *
 * No imports and no app code, so scripts/plugin-template.mjs can run it under Node
 * too (it builds a generated project to check the template works).
 */

export interface ProjectMeta {
  id: string;
  name: string;
  author: string;
  description: string;
  appVersion: string;
}

export interface ProjectSources {
  /** The template files by path in ./files, e.g. "src/index.tsx.tpl". */
  templates: Record<string, string>;
  /** packages/plugin-api/index.d.ts */
  types: string;
  /** packages/plugin-api/theme.css */
  theme: string;
  /** The app's package versions (for the tools the project uses). */
  versions: Record<string, string>;
}

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** "My Cool Plugin!" → "my-cool-plugin". */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents (é → e)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const TOOLS = ["vite", "@vitejs/plugin-react", "@tailwindcss/vite", "tailwindcss", "typescript", "@types/react", "@types/node", "fflate"];

/** Every file of the project, by path (forward slashes). */
export function projectFiles(meta: ProjectMeta, src: ProjectSources): Record<string, string> {
  if (!PLUGIN_ID.test(meta.id)) throw new Error(`"${meta.id}" isn't a valid plugin id (lowercase letters, digits and dashes).`);
  const fill = (text: string) =>
    text
      .replaceAll("%%NAME_JSON%%", JSON.stringify(meta.name))
      .replaceAll("%%NAME%%", meta.name)
      .replaceAll("%%ID%%", meta.id)
      .replaceAll("%%APP_VERSION%%", meta.appVersion);
  const version = (pkg: string) => {
    const v = src.versions[pkg];
    if (!v) throw new Error(`No version for ${pkg}`);
    return v;
  };

  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(src.templates)) {
    const out = path.replace(/\.tpl$/, "").replace(/^gitignore$/, ".gitignore");
    files[out] = fill(text);
  }
  files["types/forgor-plugin-api.d.ts"] = src.types;
  files["forgor/theme.css"] = src.theme;
  files["manifest.json"] =
    JSON.stringify({ id: meta.id, name: meta.name, version: "1.0.0", author: meta.author, description: meta.description, minAppVersion: meta.appVersion }, null, 2) + "\n";
  files["package.json"] =
    JSON.stringify(
      {
        name: `forgor-plugin-${meta.id}`,
        private: true,
        version: "1.0.0",
        description: meta.description,
        type: "module",
        scripts: { build: "vite build", zip: "vite build && node scripts/zip.mjs", typecheck: "tsc --noEmit" },
        dependencies: { "lucide-react": version("lucide-react") },
        devDependencies: Object.fromEntries(TOOLS.map((t) => [t, version(t)])),
      },
      null,
      2,
    ) + "\n";
  return files;
}
