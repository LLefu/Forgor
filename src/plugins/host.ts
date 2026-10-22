import { useUI, type PluginView } from "@/app/store";
import type { Settings } from "@/data/types";
import type { Plugin } from "./types";

/**
 * What the app offers plugins besides their contribution points. Kept apart
 * from the registry so plugins can use it without importing the registry
 * (which imports the plugins).
 */

/** Whether a plugin is on. Requirements are kept consistent when switching (registry.ts `setPluginEnabled`). */
export const isPluginEnabled = (settings: Settings, id: string) => settings.plugins[id] === true;

export const usePluginEnabled = (id: string) => useUI((s) => isPluginEnabled(s.settings, id));

/** The Plugins page with this plugin's panel (its settings) open. */
export function openPluginSettings(id: string) {
  useUI.getState().setView({ kind: "plugins" });
  useUI.getState().openPluginInfo(id);
}

let reloader: () => Promise<void> = async () => {};
/** community.tsx registers how to load the community plugins again (the registry can't import it). */
export function setPluginReloader(fn: () => Promise<void>) {
  reloader = fn;
}
export const reloadPlugins = () => reloader();

let faultHandler: (id: string, error: unknown, where: string) => void = () => {};
/** The registry decides what a fault means (switch the plugin off); anything that catches an error calls `reportPluginFault`. */
export function setFaultHandler(fn: (id: string, error: unknown, where: string) => void) {
  faultHandler = fn;
}
/** A plugin caused an error: it is switched off and labelled (never throws). */
export function reportPluginFault(id: string, error: unknown, where: string) {
  try {
    faultHandler(id, error, where);
  } catch (e) {
    console.error("Could not handle a plugin fault", e);
  }
}

let enabled: () => Plugin[] = () => [];
/** The registry tells which plugins are on (it imports the plugins, so they can't import it). */
export function setEnabledPluginsLookup(fn: () => Plugin[]) {
  enabled = fn;
}
/** The enabled plugins, for a plugin that uses others' contributions (the AI chat reads their `chat` items). */
export const enabledPlugins = () => enabled();

export const pluginView = (plugin: string, page: string, param?: string): PluginView => ({ kind: "plugin", plugin, page, ...(param ? { param } : {}) });
