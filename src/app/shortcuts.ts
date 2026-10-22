import { useUI } from "./store";
import * as notes from "@/data/notes";
import { normalizeCombo, shortcutLabel } from "@/lib/keys";

/**
 * Keyboard shortcuts: the app's own (here) and plugins' (their `shortcuts`).
 * Each has default keys; the user can change them in Settings → Shortcuts
 * (`settings.shortcuts`: id → combos, [] = off). One window listener runs
 * them (features/shortcuts/useShortcuts.ts). What the editor handles itself
 * (⌘B in a note) stays the editor's.
 */
export interface Shortcut {
  /** "new-note"; a plugin's are "<plugin id>:<id>". */
  id: string;
  label: string;
  /** Heading in Settings and the ⌘/ overview: "General", "Tabs", a plugin's name… */
  group: string;
  /** Default combos ("Mod+N"); empty: none until the user picks one. */
  keys: string[];
  run: () => void | Promise<void>;
}

/** Shown in the lists but handled elsewhere, and not changeable (zoom, tab numbers, Escape). */
export interface FixedShortcut {
  label: string;
  group: string;
  /** What to show ("⌘1 – ⌘9"). */
  display: string;
  /** The combos it takes, so nothing else can use them. */
  combos: string[];
}

const ui = () => useUI.getState();

/** New notes and folders go into the folder whose panel is open, else the top level (like the sidebar's buttons). */
const currentFolderPath = () => notes.folderPathForId(ui().selectedFolderId);

async function newNote() {
  const meta = await notes.createNote(await currentFolderPath());
  ui().setView({ kind: "note", id: meta.id });
  showSidebar();
  ui().requestRename(`n:${meta.id}`);
}

async function newFolder() {
  const f = await notes.createFolder(await currentFolderPath());
  showSidebar();
  ui().requestRename(`f:${f.id}`);
}

/** Renaming and revealing happen in the explorer: bring it back if it's hidden. */
function showSidebar() {
  if (ui().settings.sidebarHidden) void ui().updateSetting("sidebarHidden", false);
}

function cycleTab(step: number) {
  const { tabs, activeTab, activateTab } = ui();
  if (!tabs.length) return;
  const i = tabs.findIndex((t) => t.id === activeTab);
  activateTab(tabs[(i + step + tabs.length) % tabs.length].id);
}

function openNoteView() {
  const view = ui().view;
  return view?.kind === "note" ? view.id : null;
}

export const APP_SHORTCUTS: Shortcut[] = [
  // Create
  { id: "new-note", group: "Create", label: "New note", keys: ["Mod+N"], run: newNote },
  { id: "new-todo", group: "Create", label: "New todo", keys: ["Mod+Shift+A"], run: () => ui().openQuickAdd(ui().selectedFolderId ? { folderId: ui().selectedFolderId! } : {}) },
  { id: "new-folder", group: "Create", label: "New folder", keys: ["Mod+Shift+N"], run: newFolder },
  // Find
  { id: "quick-open", group: "Find", label: "Quick open", keys: ["Mod+P", "Mod+O", "Mod+Shift+F"], run: () => ui().setSearchOverlay(true) },
  {
    id: "find",
    group: "Find",
    label: "Find in note (elsewhere: search)",
    keys: ["Mod+F"],
    run: () => (openNoteView() ? window.dispatchEvent(new Event("find-in-note")) : ui().setSearchOverlay(true)),
  },
  {
    id: "search-page",
    group: "Find",
    label: "Search page",
    keys: ["Mod+K"],
    run: () => {
      ui().setView({ kind: "search" });
      setTimeout(() => window.dispatchEvent(new Event("focus-search")), 0);
    },
  },
  // Go to
  { id: "go-today", group: "Go to", label: "Today", keys: ["Mod+Shift+D"], run: () => ui().setView({ kind: "today" }) },
  { id: "go-all", group: "Go to", label: "Todos", keys: ["Mod+Shift+L"], run: () => ui().setView({ kind: "all" }) },
  { id: "go-settings", group: "Go to", label: "Settings", keys: ["Mod+,"], run: () => ui().openSettings() },
  { id: "back", group: "Go to", label: "Back", keys: ["Alt+ArrowLeft"], run: () => ui().goBack() },
  { id: "forward", group: "Go to", label: "Forward", keys: ["Alt+ArrowRight"], run: () => ui().goForward() },
  // Tabs
  { id: "next-tab", group: "Tabs", label: "Next tab", keys: ["Ctrl+Tab"], run: () => cycleTab(1) },
  { id: "previous-tab", group: "Tabs", label: "Previous tab", keys: ["Ctrl+Shift+Tab"], run: () => cycleTab(-1) },
  { id: "close-tab", group: "Tabs", label: "Close tab", keys: ["Mod+W"], run: () => ui().activeTab && ui().closeTab(ui().activeTab!) },
  { id: "reopen-tab", group: "Tabs", label: "Reopen closed tab", keys: ["Mod+Shift+T"], run: () => ui().reopenClosedTab() },
  // Note
  {
    id: "rename-note",
    group: "Note",
    label: "Rename note",
    keys: ["F2"],
    run: () => {
      const id = openNoteView();
      if (!id) return;
      showSidebar();
      ui().requestRename(`n:${id}`);
    },
  },
  {
    id: "reveal-note",
    group: "Note",
    label: "Show note in explorer",
    keys: ["Mod+Shift+E"],
    run: () => {
      const id = openNoteView();
      if (!id) return;
      showSidebar();
      ui().revealInExplorer(`n:${id}`);
    },
  },
  // General
  { id: "toggle-sidebar", group: "General", label: "Show or hide the sidebar", keys: ["Mod+\\"], run: () => void ui().updateSetting("sidebarHidden", !ui().settings.sidebarHidden) },
  { id: "shortcuts-help", group: "General", label: "All keyboard shortcuts", keys: ["Mod+/"], run: () => ui().setShortcutsHelp(!ui().shortcutsHelp) },
];

const TAB_DIGITS = Array.from({ length: 9 }, (_, i) => `Mod+${i + 1}`);

export const FIXED_SHORTCUTS: FixedShortcut[] = [
  { group: "Tabs", label: "Go to tab 1–9 (9 = the last one)", display: `${shortcutLabel("Mod+1")} – ${shortcutLabel("Mod+9")}`, combos: TAB_DIGITS },
  { group: "General", label: "Close the panel on the right", display: shortcutLabel("Escape"), combos: ["Escape"] },
  {
    group: "General",
    label: "Zoom in / out / reset",
    display: [shortcutLabel("Mod+="), shortcutLabel("Mod+-"), shortcutLabel("Mod+0")].join(" "),
    combos: ["Mod+=", "Mod+-", "Mod+0", "Mod+Shift+="],
  },
];

/** ⌘1…⌘8: that tab; ⌘9: the last one (like a browser). */
export function goToTabNumber(n: number) {
  const { tabs, activateTab } = ui();
  const tab = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
  if (tab) activateTab(tab.id);
}

export const TAB_NUMBER_COMBOS = TAB_DIGITS;

/** The combos a shortcut has now: the user's choice, else its defaults. */
export function keysOf(shortcut: Pick<Shortcut, "id" | "keys">, overrides: Record<string, string[]>): string[] {
  return overrides[shortcut.id] ?? shortcut.keys;
}

/** The first combo of an app shortcut as a label ("⌘N"), or "" when it has none. For hints and tooltips. */
export function useShortcutLabel(id: string): string {
  const overrides = useUI((s) => s.settings.shortcuts);
  const shortcut = APP_SHORTCUTS.find((s) => s.id === id);
  const first = shortcut ? keysOf(shortcut, overrides)[0] : undefined;
  return first ? shortcutLabel(first) : "";
}

/** Who already uses this combo (another shortcut's label), or null. */
export function usedBy(combo: string, shortcuts: Shortcut[], overrides: Record<string, string[]>, except?: string): string | null {
  const c = normalizeCombo(combo);
  for (const s of shortcuts) {
    if (s.id === except) continue;
    if (keysOf(s, overrides).some((k) => normalizeCombo(k) === c)) return s.label;
  }
  for (const f of FIXED_SHORTCUTS) if (f.combos.some((k) => normalizeCombo(k) === c)) return f.label;
  return null;
}
