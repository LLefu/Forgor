export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/** "Mod+K" → "Ctrl+K" on Windows, "⌘K" on macOS. */
export function shortcutLabel(combo: string): string {
  if (!isMac) return combo.replace("Mod", "Ctrl");
  return combo
    .replace("Mod", "⌘")
    .replace("Shift", "⇧")
    .replace("Alt", "⌥")
    .replace(/\+/g, "");
}

/** True when the keyboard event matches e.g. "Mod+Shift+A". */
export function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod");
  return (
    e.key.toLowerCase() === key &&
    (isMac ? e.metaKey : e.ctrlKey) === mod &&
    e.shiftKey === parts.includes("shift") &&
    e.altKey === parts.includes("alt")
  );
}
