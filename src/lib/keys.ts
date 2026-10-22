export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/**
 * Key combos are written like "Mod+Shift+A": modifiers first (Mod = ⌘ on
 * macOS and Ctrl elsewhere; Ctrl = the Control key itself, also on macOS),
 * then one key: a letter, digit, punctuation ("/", "\\", ","), or a key name
 * (ArrowLeft, Tab, Escape, Enter, Space, Backspace, F1…F12).
 */
const MODIFIERS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Physical keys whose `key` changes with Shift/Option: read them from `code` instead. */
const CODE_KEYS: Record<string, string> = {
  Slash: "/",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "Space",
};

function parse(combo: string): { mods: Set<Modifier>; key: string } {
  const parts = combo.split("+");
  // "Mod++" would be odd; "+" isn't used as a key here (zoom has its own handling)
  const key = parts.pop() ?? "";
  const mods = new Set<Modifier>();
  for (const p of parts) {
    const m = MODIFIERS.find((x) => x.toLowerCase() === p.toLowerCase());
    if (m) mods.add(m);
  }
  return { mods, key: normalizeKey(key) };
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  if (key === " ") return "Space";
  if (/^esc$/i.test(key)) return "Escape";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** The key of a keyboard event, layout-friendly: letters as typed, but not as changed by Shift or Option. */
export function eventKey(e: Pick<KeyboardEvent, "key" | "code">): string {
  if (/^[a-z0-9]$/i.test(e.key)) return e.key.toUpperCase();
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (CODE_KEYS[e.code]) return CODE_KEYS[e.code];
  return normalizeKey(e.key);
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** True when the keyboard event matches e.g. "Mod+Shift+A". */
export function matches(e: KeyEventLike, combo: string): boolean {
  const { mods, key } = parse(combo);
  if (eventKey(e) !== key) return false;
  const wantCtrl = isMac ? mods.has("Ctrl") : mods.has("Ctrl") || mods.has("Mod");
  const wantMeta = isMac && mods.has("Mod");
  return e.ctrlKey === wantCtrl && e.metaKey === wantMeta && e.altKey === mods.has("Alt") && e.shiftKey === mods.has("Shift");
}

/** The combo a key press makes ("Mod+Shift+K"), or null for a lone modifier. */
export function comboFromEvent(e: KeyEventLike): string | null {
  if (["Meta", "Control", "Alt", "Shift", "OS", "AltGraph", "CapsLock"].includes(e.key)) return null;
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (isMac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, eventKey(e)].join("+");
}

/** The same combo written the same way ("mod+shift+a" → "Mod+Shift+A"), so combos can be compared. */
export function normalizeCombo(combo: string): string {
  const { mods, key } = parse(combo);
  // On Windows/Linux Ctrl and Mod are the same key.
  const list = MODIFIERS.filter((m) => mods.has(m) && !(m === "Ctrl" && !isMac && mods.has("Mod")));
  return [...list.map((m) => (m === "Ctrl" && !isMac ? "Mod" : m)), key].join("+");
}

/** Something a shortcut may use: a modifier other than Shift, or a function key. Plain letters are for typing. */
export function isUsableCombo(combo: string): boolean {
  const { mods, key } = parse(combo);
  return /^F([1-9]|1[0-9])$/.test(key) || mods.has("Mod") || mods.has("Ctrl") || mods.has("Alt");
}

/** Combos the system or every text field needs: never offered to a shortcut. */
export function reservedReason(combo: string): string | null {
  const c = normalizeCombo(combo);
  const editing = ["Mod+C", "Mod+V", "Mod+X", "Mod+Z", "Mod+Shift+Z", "Mod+A", "Mod+Y"];
  if (editing.includes(c)) return "copy, paste, undo and select all need it";
  const system = isMac ? ["Mod+Q", "Mod+H", "Mod+M", "Mod+Tab", "Mod+Space", "Mod+Alt+Escape"] : ["Alt+F4", "Alt+Tab"];
  if (system.includes(c)) return "your system uses it";
  return null;
}

const MAC_SYMBOLS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Enter: "↩",
  Backspace: "⌫",
  Tab: "⇥",
};

/** "Mod+K" → "Ctrl+K" on Windows, "⌘K" on macOS. */
export function shortcutLabel(combo: string): string {
  const { mods, key } = parse(combo);
  if (isMac) {
    const sym = [mods.has("Ctrl") && "⌃", mods.has("Alt") && "⌥", mods.has("Shift") && "⇧", mods.has("Mod") && "⌘"].filter(Boolean).join("");
    return sym + (MAC_SYMBOLS[key] ?? key);
  }
  const names = [(mods.has("Mod") || mods.has("Ctrl")) && "Ctrl", mods.has("Alt") && "Alt", mods.has("Shift") && "Shift"].filter(Boolean);
  const keyName = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc" }[key] ?? key;
  return [...names, keyName].join("+");
}

// ---------------------------------------------------------------- the global shortcut (Tauri's format)

/** Our combo → the global-shortcut plugin's ("Mod+Shift+Space" → "CommandOrControl+Shift+Space"); null when it can't be global. */
export function toGlobalCombo(combo: string): string | null {
  const { mods, key } = parse(combo);
  if (!/^([A-Z0-9]|Space|F([1-9]|1[0-9]))$/.test(key)) return null;
  const parts = [mods.has("Mod") && "CommandOrControl", mods.has("Ctrl") && "Control", mods.has("Alt") && "Alt", mods.has("Shift") && "Shift"].filter(Boolean);
  return [...parts, key].join("+");
}

/** The stored global shortcut ("CommandOrControl+Shift+Space", "Control+Alt+Space") in our format. */
export function fromGlobalCombo(value: string): string {
  const parts = value.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((p) => {
    const l = p.toLowerCase();
    if (["commandorcontrol", "cmdorctrl", "command", "cmd", "super", "meta"].includes(l)) return "Mod";
    if (["control", "ctrl"].includes(l)) return isMac ? "Ctrl" : "Mod";
    if (["alt", "option"].includes(l)) return "Alt";
    return "Shift";
  });
  return normalizeCombo([...mods, key.replace(/^Key/, "")].join("+"));
}
