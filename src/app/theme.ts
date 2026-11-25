import { useEffect } from "react";
import { useUI } from "./store";
import { getAccent } from "@/lib/accents";
import { readableOn, isHex } from "@/lib/colors";
import { THEME_TOKENS, presetMode, presetTokens, useActivePreset } from "@/plugins/themes";

/**
 * Applies the theme: the `dark` class on <html> (following the OS when
 * "system"), `soft` for softer colors (index.css), and the highlight color as
 * --primary / --primary-foreground. A plugin's theme preset (plugins/themes.ts)
 * sets its tokens inline on <html> instead, with `data-theme-preset` for the
 * plugin's own CSS; its own --primary wins over the highlight color.
 */
export function useApplyTheme() {
  const theme = useUI((s) => s.settings.theme);
  const soft = useUI((s) => s.settings.themeSoft);
  const accentId = useUI((s) => s.settings.accent);
  const preset = useActivePreset();
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const wantDark = theme === "dark" || (theme === "system" && mq.matches);
      const root = document.documentElement;
      for (const token of THEME_TOKENS) root.style.removeProperty(`--${token}`);
      const mode = preset ? presetMode(preset, wantDark) : wantDark ? "dark" : "light";
      const dark = mode === "dark";
      root.classList.toggle("dark", dark);
      root.classList.toggle("soft", !preset && !!soft);
      if (preset) root.dataset.themePreset = preset.key;
      else delete root.dataset.themePreset;

      const tokens = preset ? presetTokens(preset, mode) : {};
      for (const [token, value] of Object.entries(tokens)) root.style.setProperty(`--${token}`, value);
      if (tokens.primary) {
        if (!tokens["primary-foreground"] && isHex(tokens.primary)) root.style.setProperty("--primary-foreground", readableOn(tokens.primary));
        return;
      }
      const accent = getAccent(accentId);
      root.style.setProperty("--primary", dark ? accent.dark : accent.light);
      root.style.setProperty("--primary-foreground", dark ? (accent.darkForeground ?? "#ffffff") : (accent.lightForeground ?? "#ffffff"));
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, soft, accentId, preset]);
}
