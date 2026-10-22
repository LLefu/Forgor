import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { Puzzle } from "lucide-react";
import { useUI } from "@/app/store";
import { deletePluginValues } from "@/data/pluginStorage";
import { confirmDialog } from "@/components/ConfirmDialog";
import { bundleFiles, localPlugins, type PluginBundle, type PluginFiles } from "@/platform/plugins";
import { unzipPlugin, zipPlugin } from "./zip";
import { needsNewerApp, newerAppWarning } from "./compat";
import { sanitizeDefinition } from "./validate";
import { setPluginReloader } from "./host";
import { showNotice } from "@/components/Toasts";
import { createPluginApi, type PluginFactory, type PluginManifest } from "./api";
import { PLUGINS, setCommunityPlugins } from "./registry";
import type { Plugin } from "./types";
import { PluginFileIcon } from "./ui";

/**
 * Community plugins: loaded from their folders (platform/plugins.ts) at
 * startup and after installing or removing one. A plugin's main.js is a
 * CommonJS bundle; `require` gives it the app's own React (a second copy of
 * React would break hooks). A plugin that fails to load is still listed, with
 * the error, so it can be removed.
 */

const SHARED: Record<string, unknown> = { react: React, "react-dom": ReactDOM, "react/jsx-runtime": jsxRuntime };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

let startup: Promise<void> | null = null;

/** The files each community plugin was loaded from (to export or publish it). */
const loaded = new Map<string, PluginBundle>();

/** A community plugin's files, as loaded. */
export function pluginFiles(id: string): PluginFiles | null {
  const bundle = loaded.get(id);
  return bundle ? bundleFiles(bundle) : null;
}

/** A community plugin as a zip (to share or publish it). */
export function pluginZip(id: string): Uint8Array {
  const files = pluginFiles(id);
  if (!files) throw new Error("This plugin's files aren't available.");
  return zipPlugin(files);
}

/** Save a community plugin as <id>-<version>.zip. */
export async function exportPlugin(id: string) {
  const plugin = PLUGINS.find((p) => p.id === id);
  await localPlugins().saveFile(`${id}-${plugin?.version ?? "0.0.0"}.zip`, pluginZip(id));
}

/**
 * At startup, once per window (React StrictMode runs the startup effect twice;
 * a second load would remount the app while it is already in use).
 */
export function loadCommunityPluginsOnce(opts: { safeMode?: boolean } = {}): Promise<void> {
  startup ??= loadCommunityPlugins(opts);
  return startup;
}

/** (Re)load every community plugin; the app remounts with the new list. */
export async function loadCommunityPlugins(opts: { safeMode?: boolean } = {}): Promise<void> {
  let bundles: PluginBundle[] = [];
  try {
    bundles = await localPlugins().list();
  } catch (e) {
    console.error("Could not list plugins", e);
  }
  const builtIn = new Set(PLUGINS.filter((p) => p.builtIn).map((p) => p.id));
  if (opts.safeMode) await switchOffForSafeMode(bundles, builtIn);
  const byId = new Map<string, Plugin>();
  loaded.clear();
  for (const bundle of bundles) {
    const plugin = evaluate(bundle);
    if (builtIn.has(plugin.id)) continue; // a folder can't replace a built-in plugin
    if (byId.has(plugin.id)) continue;
    byId.set(plugin.id, plugin);
    loaded.set(plugin.id, bundle);
  }
  setCommunityPlugins([...byId.values()]);
}

function evaluate(bundle: PluginBundle): Plugin {
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(bundle.manifest) as PluginManifest;
  } catch {
    return broken(bundle, bundle.dir, "manifest.json is missing or isn't valid JSON.");
  }
  const id = String(manifest.id ?? "");
  if (!ID.test(id)) return broken(bundle, bundle.dir, `"${id}" isn't a valid plugin id (lowercase letters, digits and dashes).`, manifest);
  if (!bundle.main) return broken(bundle, id, "main.js is missing.", manifest);
  // Switched off after an error: not even loaded (its code is what crashed or froze Forgor). It is loaded again when the user switches it on.
  const { plugins, pluginFaults } = useUI.getState().settings;
  if (pluginFaults[id] && plugins[id] !== true) return { ...meta(bundle, id, manifest), icon: iconOf(bundle), deferred: true };
  try {
    const module = { exports: {} as Record<string, unknown> };
    const require = (name: string) => {
      if (name in SHARED) return SHARED[name];
      throw new Error(`"${name}" isn't available to plugins; bundle it into main.js.`);
    };
    new Function("module", "exports", "require", `${bundle.main}\n//# sourceURL=forgor-plugin://${id}/main.js`)(module, module.exports, require);
    const exported = (module.exports.default ?? module.exports) as unknown;
    if (typeof exported !== "function") throw new Error("main.js must export a function: export default (api) => ({ … })");
    const { definition, warnings } = sanitizeDefinition((exported as PluginFactory)(createPluginApi(id)));
    // Made for a newer Forgor: it still loads, with a warning (a plugin that then misbehaves is switched off like any other).
    if (manifest.minAppVersion && needsNewerApp(manifest.minAppVersion)) warnings.unshift(newerAppWarning(manifest.minAppVersion));
    return {
      ...definition,
      warnings: warnings.length ? warnings : undefined,
      ...meta(bundle, id, manifest),
      icon: definition.icon ?? iconOf(bundle),
      styles: bundle.styles,
    };
  } catch (e) {
    console.error(`Plugin "${id}" failed to load`, e);
    return broken(bundle, id, String((e as Error)?.message ?? e), manifest);
  }
}

function meta(bundle: PluginBundle, id: string, m: Partial<PluginManifest>) {
  return {
    id,
    name: m.name || id,
    version: m.version || "0.0.0",
    author: m.author || "Unknown",
    description: m.description || "",
    requires: m.requires,
    models: m.models,
    minAppVersion: m.minAppVersion,
    source: bundle.source,
  };
}

function broken(bundle: PluginBundle, id: string, error: string, m: Partial<PluginManifest> = {}): Plugin {
  return { ...meta(bundle, id, m), icon: iconOf(bundle), error };
}

function iconOf(bundle: PluginBundle): Plugin["icon"] {
  const url = bundle.icon;
  if (!url) return Puzzle;
  return function PluginIcon({ className }: { className?: string }) {
    return <PluginFileIcon url={url} className={className} />;
  };
}

/** a > b for "x.y.z" versions. */
/**
 * Forgor didn't start properly the last times (it froze or crashed before it
 * got going): switch off every community plugin and label it, so Forgor opens
 * and the user switches them back on one by one. Switched-off plugins aren't
 * loaded (evaluate), so a plugin that hangs when it loads can't hang this start.
 */
async function switchOffForSafeMode(bundles: PluginBundle[], builtIn: Set<string>) {
  const ui = useUI.getState();
  const plugins = { ...ui.settings.plugins };
  const faults = { ...ui.settings.pluginFaults };
  const names: string[] = [];
  for (const bundle of bundles) {
    let id: string;
    try {
      id = String((JSON.parse(bundle.manifest) as { id?: unknown }).id ?? "");
    } catch {
      continue;
    }
    if (!ID.test(id) || builtIn.has(id) || plugins[id] !== true) continue;
    plugins[id] = false;
    faults[id] = { message: "Forgor didn't start properly the last times, so this plugin was switched off to be safe. If it isn't the cause you can switch it on again.", where: "starting Forgor", at: new Date().toISOString() };
    names.push(id);
  }
  if (!names.length) return;
  await ui.updateSetting("plugins", plugins);
  await ui.updateSetting("pluginFaults", faults);
  showNotice("Plugins switched off", "Forgor didn't start properly the last times, so community plugins were switched off. Switch them on again one by one on the Plugins page.");
}

setPluginReloader(() => loadCommunityPlugins());

// ---------------------------------------------------------------- install / remove

/**
 * Before installing a plugin Forgor hasn't checked (not verified in the store, or
 * any zip): plugins run with the app's own access, and the author is just what
 * the uploader typed (anyone can write "Forgor"). Updates don't ask again.
 */
export function confirmUnverifiedInstall(p: { name: string; author: string; fromZip?: boolean; minAppVersion?: string | null }): Promise<boolean> {
  const who = p.author ? `It says it's made by “${p.author}”, but anyone can type any name there.` : "It doesn't say who made it.";
  return confirmDialog({
    title: `Install ${p.name}?`,
    message: [
      p.fromZip ? "This plugin comes from a zip file, so Forgor can't check it." : "Forgor hasn't checked this plugin.",
      who,
      "A plugin can read, change and delete your notes and todos, read your Jira tickets, and send what it reads over the internet. Only install it if you trust who made it.",
      ...(needsNewerApp(p.minAppVersion) ? [newerAppWarning(p.minAppVersion!)] : []),
    ].join("\n\n"),
    confirmLabel: "Install",
  });
}

/** Asks for a plugin zip and installs it (after the warning). Returns the plugin, or null when cancelled. */
export async function installPluginFromZip(): Promise<Plugin | null> {
  const zip = await localPlugins().pickZip();
  if (!zip) return null;
  const files = unzipPlugin(zip);
  let manifest: Partial<PluginManifest> = {};
  try {
    manifest = JSON.parse(String(files["manifest.json"])) as Partial<PluginManifest>;
  } catch {
    // installPlugin explains what's wrong
  }
  if (typeof files["manifest.json"] === "string" && typeof manifest === "object" && manifest) {
    const ok = await confirmUnverifiedInstall({ name: String(manifest.name || manifest.id || "this plugin"), author: String(manifest.author ?? ""), fromZip: true, minAppVersion: manifest.minAppVersion });
    if (!ok) return null;
  }
  return installPlugin(files);
}

/**
 * Asks for a zip to update `plugin` with: it must be the same plugin (id).
 * Returns the files and the zip's version, or null when cancelled.
 */
export async function pickUpdateZip(plugin: Plugin): Promise<{ files: PluginFiles; version: string } | null> {
  const zip = await localPlugins().pickZip();
  if (!zip) return null;
  const files = unzipPlugin(zip);
  let manifest: Partial<PluginManifest>;
  try {
    manifest = JSON.parse(String(files["manifest.json"])) as Partial<PluginManifest>;
  } catch {
    throw new Error("The zip's manifest.json isn't valid JSON.");
  }
  if (manifest.id !== plugin.id) throw new Error(`That zip is ${manifest.name ? `“${manifest.name}”` : "another plugin"} (id "${manifest.id ?? "?"}"), not ${plugin.name} ("${plugin.id}").`);
  return { files, version: String(manifest.version ?? "0.0.0") };
}

export async function installPlugin(files: PluginFiles): Promise<Plugin> {
  if (typeof files["manifest.json"] !== "string") throw new Error("That folder has no manifest.json. Choose the plugin's built folder (with manifest.json and main.js).");
  if (typeof files["main.js"] !== "string") throw new Error("That folder has no main.js. Build the plugin first and choose its output folder.");
  let id: string;
  try {
    id = String((JSON.parse(files["manifest.json"]) as PluginManifest).id ?? "");
  } catch {
    throw new Error("manifest.json isn't valid JSON.");
  }
  if (!ID.test(id)) throw new Error(`"${id}" isn't a valid plugin id (lowercase letters, digits and dashes).`);
  if (PLUGINS.some((p) => p.builtIn && p.id === id)) throw new Error(`"${id}" is the id of a built-in plugin.`);
  await localPlugins().remove(id); // no files of an older version left behind
  await localPlugins().install(id, files);
  await loadCommunityPlugins();
  const plugin = PLUGINS.find((p) => p.id === id)!;
  // Just installed: on, unless it couldn't load.
  if (!plugin.error && !useUI.getState().settings.plugins[id]) await useUI.getState().updateSetting("plugins", { ...useUI.getState().settings.plugins, [id]: true });
  return plugin;
}

/** Removes an installed plugin's folder. Its stored data stays unless `deleteData`. */
export async function uninstallPlugin(id: string, deleteData: boolean): Promise<void> {
  const { plugins } = useUI.getState().settings;
  if (plugins[id]) await useUI.getState().updateSetting("plugins", { ...plugins, [id]: false });
  await localPlugins().remove(id);
  if (deleteData) await deletePluginValues(id);
  if (useUI.getState().selectedPluginId === id) useUI.getState().openPluginInfo(null);
  await loadCommunityPlugins();
}
