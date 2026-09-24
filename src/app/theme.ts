import { useEffect } from "react";
import { useUI } from "./store";
import { getAccent } from "@/lib/accents";

/**
 * Applies the theme: the `dark` class on <html> (following the OS when
 * "system") and the highlight color as --primary / --primary-foreground.
 */
export function useApplyTheme() {
  const theme = useUI((s) => s.settings.theme);
  const accentId = useUI((s) => s.settings.accent);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      const root = document.documentElement;
      root.classList.toggle("dark", dark);
      const accent = getAccent(accentId);
      root.style.setProperty("--primary", dark ? accent.dark : accent.light);
      root.style.setProperty("--primary-foreground", dark ? (accent.darkForeground ?? "#ffffff") : "#ffffff");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, accentId]);
}
