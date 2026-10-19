import { create } from "zustand";
import type { Settings } from "@/data/types";
import type { TodoInput } from "@/data/todos";
import { DEFAULT_SETTINGS, saveSetting } from "@/data/settings";
import { ctx } from "@/data/context";
import { newId } from "@/lib/utils";
import { emitAppEvent } from "./events";

export type PageKind = "inbox" | "today" | "all" | "search" | "archive" | "trash" | "settings" | "plugins";
/** A page of a plugin (src/plugins): `page` is one of its `pages`, `param` e.g. a folder id. */
export type PluginView = { kind: "plugin"; plugin: string; page: string; param?: string };
export type View = { kind: PageKind } | { kind: "note"; id: string } | PluginView;

export interface Tab {
  id: string;
  view: View;
}

export const sameView = (a: View, b: View) =>
  a.kind === b.kind &&
  (a.kind !== "note" || (b.kind === "note" && a.id === b.id)) &&
  (a.kind !== "plugin" || (b.kind === "plugin" && a.plugin === b.plugin && a.page === b.page && (a.param ?? null) === (b.param ?? null)));

/** A right-hand panel of a plugin (e.g. a Jira ticket). `fromFolder`: opened from that folder's panel (back button). */
export interface PluginPanel {
  plugin: string;
  panel: string;
  param: string;
  fromFolder?: string | null;
}

interface UIState {
  /** Tabs across the top. Every note gets its own tab; the pages (Today, Search…) share one. */
  tabs: Tab[];
  /** null = no tabs open (the "nothing open" state). */
  activeTab: string | null;
  /** The active tab's view (kept in sync with `tabs`); null when nothing is open. */
  view: View | null;
  back: View[];
  forward: View[];
  setView: (v: View) => void;
  goBack: () => void;
  goForward: () => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  moveTab: (id: string, toIndex: number) => void;

  /** The right-hand detail panel shows one thing at a time: a todo, a folder, a plugin's info or a plugin's own panel. */
  selectedTodoId: string | null;
  openTodo: (id: string | null) => void;
  selectedFolderId: string | null;
  openFolder: (id: string | null) => void;
  /** The plugin whose info and settings are shown (Plugins page). */
  selectedPluginId: string | null;
  openPluginInfo: (id: string | null) => void;
  pluginPanel: PluginPanel | null;
  openPluginPanel: (panel: PluginPanel | null) => void;
  closePanel: () => void;

  /** Explorer item ("f:<id>" / "n:<id>") to put into rename mode once it appears in the tree. */
  pendingRename: string | null;
  requestRename: (treeId: string | null) => void;
  /** Explorer item to expand to, scroll to and select (the counter re-triggers the same item). */
  reveal: { treeId: string; n: number } | null;
  revealInExplorer: (treeId: string) => void;

  searchOverlay: boolean;
  setSearchOverlay: (open: boolean) => void;

  quickAdd: { open: boolean; defaults: TodoInput };
  openQuickAdd: (defaults?: TodoInput) => void;
  closeQuickAdd: () => void;

  settings: Settings;
  initSettings: (s: Settings) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

// ---------------------------------------------------------------- tab persistence (per device)

const TABS_KEY = "forgor.tabs";

/** Pages that no longer exist: the calendar (removed in 0.5), one board's page (now per folder, 0.5.1). */
const REMOVED_PAGES: string[] = ["calendar", "jira-board"];

/**
 * A saved tab's view as it is now: up to 0.5.1 the Jira and Meetings pages
 * were app pages ("jira", "jira-folder", "meetings"); now they are plugin
 * pages. null: drop the tab (a removed page or a corrupt entry).
 */
export function migrateView(v: unknown): View | null {
  if (!v || typeof v !== "object") return null;
  const view = v as Record<string, unknown>;
  const kind = view.kind;
  if (typeof kind !== "string" || REMOVED_PAGES.includes(kind)) return null;
  if (kind === "jira") return { kind: "plugin", plugin: "jira", page: "overview" };
  if (kind === "jira-folder") return typeof view.folderId === "string" ? { kind: "plugin", plugin: "jira", page: "folder", param: view.folderId } : null;
  if (kind === "meetings") return { kind: "plugin", plugin: "meetings", page: "list" };
  if (kind === "note") return typeof view.id === "string" ? { kind: "note", id: view.id } : null;
  if (kind === "plugin") {
    if (typeof view.plugin !== "string" || typeof view.page !== "string") return null;
    return { kind: "plugin", plugin: view.plugin, page: view.page, ...(typeof view.param === "string" ? { param: view.param } : {}) };
  }
  return { kind } as View;
}

function loadTabs(): { tabs: Tab[]; activeTab: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null") as { tabs: Tab[]; activeTab: string | null } | null;
    if (raw && Array.isArray(raw.tabs)) {
      // Drops tabs of pages that no longer exist (the calendar was removed in 0.5).
      const tabs = raw.tabs.flatMap((t) => {
        const view = t && t.id ? migrateView(t.view) : null;
        return view ? [{ id: t.id, view }] : [];
      });
      return { tabs, activeTab: tabs.some((t) => t.id === raw.activeTab) ? raw.activeTab : (tabs[0]?.id ?? null) };
    }
  } catch {
    // unavailable or corrupt: start fresh
  }
  const id = newId();
  return { tabs: [{ id, view: { kind: "today" } }], activeTab: id };
}

function saveTabs(tabs: Tab[], activeTab: string | null) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTab }));
  } catch {
    // ignore
  }
}

const initial = loadTabs();

export const useUI = create<UIState>((set, get) => {
  /** Show `v`: reuse a tab that already shows it, else a note opens a new tab and a page reuses the page tab. */
  const navigate = (v: View) => {
    const { tabs, activeTab } = get();
    const existing = tabs.find((t) => sameView(t.view, v));
    if (existing) return commit(tabs, existing.id);
    const at = tabs.findIndex((t) => t.id === activeTab);
    const active = tabs[at];
    if (v.kind !== "note") {
      const page = active && active.view.kind !== "note" ? active : tabs.find((t) => t.view.kind !== "note");
      if (page) return commit(tabs.map((t) => (t.id === page.id ? { ...t, view: v } : t)), page.id);
    }
    const tab = { id: newId(), view: v };
    const next = [...tabs];
    next.splice(at < 0 ? next.length : at + 1, 0, tab);
    commit(next, tab.id);
  };
  const commit = (tabs: Tab[], activeTab: string | null) => {
    const view = tabs.find((t) => t.id === activeTab)?.view ?? null;
    set({ tabs, activeTab, view });
    saveTabs(tabs, activeTab);
  };
  const remove = (keep: (t: Tab, i: number) => boolean, preferActive?: string) => {
    const { tabs, activeTab } = get();
    const next = tabs.filter(keep);
    if (!next.length) return commit([], null);
    let active = next.some((t) => t.id === activeTab) ? activeTab : preferActive && next.some((t) => t.id === preferActive) ? preferActive : null;
    if (!active) {
      // Like a browser: activate the tab that slid into the closed one's place.
      const oldIndex = tabs.findIndex((t) => t.id === activeTab);
      active = next[Math.min(oldIndex, next.length - 1)].id;
    }
    commit(next, active);
  };

  return {
    ...initial,
    view: initial.tabs.find((t) => t.id === initial.activeTab)?.view ?? null,
    back: [],
    forward: [],
    // Global browser-style history over everything shown in any tab.
    setView: (v) => {
      const cur = get().view;
      if (cur && sameView(cur, v)) return;
      set({ back: cur ? [...get().back.slice(-50), cur] : get().back, forward: [] });
      navigate(v);
    },
    goBack: () => {
      const back = [...get().back];
      const prev = back.pop();
      if (!prev) return;
      const cur = get().view;
      set({ back, forward: cur ? [cur, ...get().forward] : get().forward });
      navigate(prev);
    },
    goForward: () => {
      const [next, ...forward] = get().forward;
      if (!next) return;
      const cur = get().view;
      set({ forward, back: cur ? [...get().back, cur] : get().back });
      navigate(next);
    },
    activateTab: (id) => {
      const { tabs, view } = get();
      const tab = tabs.find((t) => t.id === id);
      if (!tab || id === get().activeTab) return;
      if (view) set({ back: [...get().back.slice(-50), view], forward: [] });
      commit(tabs, id);
    },
    closeTab: (id) => remove((t) => t.id !== id),
    closeOtherTabs: (id) => remove((t) => t.id === id, id),
    closeAllTabs: () => remove(() => false),
    moveTab: (id, toIndex) => {
      const tabs = [...get().tabs];
      const from = tabs.findIndex((t) => t.id === id);
      if (from < 0) return;
      const [tab] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
      commit(tabs, get().activeTab);
    },

    selectedTodoId: null,
    openTodo: (id) => set({ selectedTodoId: id, selectedFolderId: null, selectedPluginId: null, pluginPanel: null }),
    selectedFolderId: null,
    openFolder: (id) => {
      set({ selectedFolderId: id, selectedTodoId: null, selectedPluginId: null, pluginPanel: null });
      if (id) emitAppEvent("folder-open", id);
    },
    selectedPluginId: null,
    openPluginInfo: (id) => set({ selectedPluginId: id, selectedTodoId: null, selectedFolderId: null, pluginPanel: null }),
    pluginPanel: null,
    openPluginPanel: (panel) => set({ pluginPanel: panel, selectedTodoId: null, selectedFolderId: null, selectedPluginId: null }),
    closePanel: () => set({ selectedFolderId: null, selectedTodoId: null, selectedPluginId: null, pluginPanel: null }),

    pendingRename: null,
    requestRename: (treeId) => set({ pendingRename: treeId }),
    reveal: null,
    revealInExplorer: (treeId) => set({ reveal: { treeId, n: (get().reveal?.n ?? 0) + 1 } }),

    searchOverlay: false,
    setSearchOverlay: (open) => set({ searchOverlay: open }),

    quickAdd: { open: false, defaults: {} },
    openQuickAdd: (defaults = {}) => set({ quickAdd: { open: true, defaults } }),
    closeQuickAdd: () => set({ quickAdd: { open: false, defaults: {} } }),

    settings: DEFAULT_SETTINGS,
    initSettings: (s) => set({ settings: s }),
    updateSetting: async (key, value) => {
      set({ settings: { ...get().settings, [key]: value } });
      await saveSetting(ctx().sql, key, value);
    },
  };
});
