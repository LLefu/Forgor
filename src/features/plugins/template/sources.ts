import pkg from "../../../../package.json";
import types from "../../../../packages/plugin-api/index.d.ts?raw";
import theme from "../../../../packages/plugin-api/theme.css?raw";
import type { ProjectSources } from "./project";

const raw = import.meta.glob<string>("./files/**/*.tpl", { query: "?raw", import: "default", eager: true });

/** The template, as bundled into the app. */
export const projectSources: ProjectSources = {
  templates: Object.fromEntries(Object.entries(raw).map(([path, text]) => [path.replace(/^\.\/files\//, ""), text])),
  types,
  theme,
  versions: { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>,
};
