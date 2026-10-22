import { useEffect, useMemo } from "react";
import { useUI } from "@/app/store";
import { APP_SHORTCUTS, goToTabNumber, keysOf, TAB_NUMBER_COMBOS, usedBy, type Shortcut } from "@/app/shortcuts";
import { showError } from "@/components/Toasts";
import { isUsableCombo, matches, reservedReason } from "@/lib/keys";
import { useEnabledPlugins } from "@/plugins/registry";
import type { Plugin } from "@/plugins/types";

/**
 * The app's shortcuts, then each enabled plugin's (id "<plugin>:<id>", under
 * its name). A plugin's default combo that's taken already (or not allowed)
 * is dropped; the user can still give it one in Settings.
 */
export function collectShortcuts(plugins: Plugin[], overrides: Record<string, string[]>): Shortcut[] {
  const all = [...APP_SHORTCUTS];
  for (const p of plugins) {
    for (const s of p.shortcuts ?? []) {
      const id = `${p.id}:${s.id}`;
      const keys = (s.keys ?? []).filter((k) => isUsableCombo(k) && !reservedReason(k) && !usedBy(k, all, overrides, id));
      all.push({ id, label: s.label, group: p.name, keys, run: s.run });
    }
  }
  return all;
}

export function useAllShortcuts(): Shortcut[] {
  const plugins = useEnabledPlugins();
  const overrides = useUI((s) => s.settings.shortcuts);
  return useMemo(() => collectShortcuts(plugins, overrides), [plugins, overrides]);
}

/** The one keyboard listener for every shortcut (main window). */
export function useShortcuts() {
  const shortcuts = useAllShortcuts();
  const overrides = useUI((s) => s.settings.shortcuts);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Handled already (the editor's own ⌘B…), or typing with an input method.
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement;
      if (e.key === "Escape") {
        // Close the right-hand panel: the todo first (it sits on top of a folder), then the folder.
        if (!target.closest("input, textarea, [role=dialog], [role=menu]")) useUI.getState().closePanel();
        return;
      }
      const inDialog = !!target.closest?.("[role=dialog]");
      const tabNumber = TAB_NUMBER_COMBOS.findIndex((c) => matches(e, c));
      if (tabNumber >= 0) {
        if (inDialog) return;
        e.preventDefault();
        goToTabNumber(tabNumber + 1);
        return;
      }
      for (const s of shortcuts) {
        if (!keysOf(s, overrides).some((k) => matches(e, k))) continue;
        // In a dialog only the overview toggles (the rest would act behind it).
        if (inDialog && s.id !== "shortcuts-help") return;
        e.preventDefault();
        Promise.resolve()
          .then(s.run)
          .catch((err) => showError(err, s.label));
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, overrides]);
}
