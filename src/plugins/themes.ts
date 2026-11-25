import { useMemo } from "react";
import { useUI } from "@/app/store";
import { useEnabledPlugins, usePluginsVersion } from "./registry";
import type { PluginTheme, ThemeTokens } from "./types";
import { THEME_TOKENS, tokenName, type ThemeToken } from "@/lib/themeTokens";

/**
 * Theme presets from plugins (`themes`): a full set of the app's color tokens
 * for light and/or dark mode, picked in Settings → Appearance
 * (`settings.themePreset` = "<plugin id>:<theme id>").
 */

export { THEME_TOKENS, tokenName, type ThemeToken };

export interface ActivePreset {
  key: string;
  name: string;
  light?: ThemeTokens;
  dark?: ThemeTokens;
}

export const presetKey = (pluginId: string, themeId: string) => `${pluginId}:${themeId}`;

/** Every preset of the enabled plugins, for the picker. */
export function useThemePresets(): (ActivePreset & { pluginName: string })[] {
  const plugins = useEnabledPlugins();
  return useMemo(
    () =>
      plugins.flatMap((p) =>
        (p.themes ?? []).map((t: PluginTheme) => ({ key: presetKey(p.id, t.id), name: t.name, light: t.light, dark: t.dark, pluginName: p.name })),
      ),
    [plugins],
  );
}

const CACHE = "forgor.themePreset";

function cached(): ActivePreset | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? "null") as ActivePreset | null;
  } catch {
    return null;
  }
}

function remember(preset: ActivePreset | null) {
  try {
    if (preset) localStorage.setItem(CACHE, JSON.stringify(preset));
    else localStorage.removeItem(CACHE);
  } catch {
    // storage unavailable: only costs a flash of the default colors at start
  }
}

/**
 * The preset in use, or null (the app's own colors). Community plugins load a
 * moment after start; until then the last used preset comes from a cache, so
 * the app doesn't flash its default colors first.
 */
export function useActivePreset(): ActivePreset | null {
  const chosen = useUI((s) => s.settings.themePreset);
  const presets = useThemePresets();
  const loaded = usePluginsVersion((s) => s.version) > 0;
  return useMemo(() => {
    if (!chosen) return null;
    const found = presets.find((p) => p.key === chosen);
    if (found) {
      const preset = { key: found.key, name: found.name, light: found.light, dark: found.dark };
      remember(preset);
      return preset;
    }
    if (!loaded) {
      const last = cached();
      if (last?.key === chosen) return last;
    }
    return null; // its plugin is off or gone: the choice stays for when it's back
  }, [chosen, presets, loaded]);
}

/** Dark or light for this preset: one with a single mode always uses that one. */
export function presetMode(preset: ActivePreset, wantDark: boolean): "light" | "dark" {
  if (!preset.dark) return "light";
  if (!preset.light) return "dark";
  return wantDark ? "dark" : "light";
}

/** The preset's tokens for a mode, keyed without "--". */
export function presetTokens(preset: ActivePreset, mode: "light" | "dark"): Partial<Record<ThemeToken, string>> {
  const out: Partial<Record<ThemeToken, string>> = {};
  for (const [k, v] of Object.entries(preset[mode] ?? {})) {
    const name = tokenName(k);
    if ((THEME_TOKENS as readonly string[]).includes(name) && typeof v === "string") out[name as ThemeToken] = v;
  }
  return out;
}

/** Whether the preset brings its own highlight color (then the picker is off). */
export function presetSetsPrimary(preset: ActivePreset | null): boolean {
  if (!preset) return false;
  return (["light", "dark"] as const).some((m) => presetTokens(preset, m).primary !== undefined);
}
