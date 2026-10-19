import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PLUGIN_FILES, type PluginFiles } from "@/platform/plugins";

/** A plugin as a zip: its files at the top, or in one folder (how "Compress folder" makes it). Only the plugin's own file names are kept. */
export function unzipPlugin(zip: Uint8Array): PluginFiles {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Error("That isn't a valid zip file.");
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith("/") && !n.startsWith("__MACOSX/") && !n.split("/").pop()!.startsWith("."));
  const manifest = names.filter((n) => n.split("/").pop() === "manifest.json").sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!manifest) throw new Error("The zip has no manifest.json.");
  const base = manifest.slice(0, -"manifest.json".length);
  const out: PluginFiles = {};
  for (const name of PLUGIN_FILES) {
    const bytes = entries[base + name];
    if (!bytes) continue;
    out[name] = name === "icon.png" ? bytes : strFromU8(bytes);
  }
  return out;
}

export function zipPlugin(files: PluginFiles): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) entries[name] = typeof content === "string" ? strToU8(content) : content;
  return zipSync(entries, { level: 9, mtime: new Date("2000-01-01") });
}
