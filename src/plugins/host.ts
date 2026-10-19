import { useUI, type PluginView } from "@/app/store";
import type { Settings } from "@/data/types";

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

export const pluginView = (plugin: string, page: string, param?: string): PluginView => ({ kind: "plugin", plugin, page, ...(param ? { param } : {}) });
