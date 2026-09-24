import { useEffect } from "react";
import { useUI } from "./store";

/** Applies the `dark` class on <html> from the theme setting (following the OS when "system"). */
export function useApplyTheme() {
  const theme = useUI((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
