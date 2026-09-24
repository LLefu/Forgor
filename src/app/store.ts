import { create } from "zustand";
import type { Settings } from "@/data/types";
import type { TodoInput } from "@/data/todos";
import { DEFAULT_SETTINGS, saveSetting } from "@/data/settings";
import { ctx } from "@/data/context";

export type View =
  | { kind: "inbox" | "today" | "upcoming" | "calendar" | "search" | "archive" | "trash" | "settings" }
  | { kind: "note"; id: string }
  | { kind: "folder"; id: string };

interface UIState {
  view: View;
  back: View[];
  setView: (v: View) => void;
  goBack: () => void;

  selectedTodoId: string | null;
  openTodo: (id: string | null) => void;

  /** Explorer item ("f:<id>" / "n:<id>") to put into rename mode once it appears in the tree. */
  pendingRename: string | null;
  requestRename: (treeId: string | null) => void;

  quickAdd: { open: boolean; defaults: TodoInput };
  openQuickAdd: (defaults?: TodoInput) => void;
  closeQuickAdd: () => void;

  settings: Settings;
  initSettings: (s: Settings) => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

export const useUI = create<UIState>((set, get) => ({
  view: { kind: "today" },
  back: [],
  setView: (v) => {
    const cur = get().view;
    if (JSON.stringify(cur) === JSON.stringify(v)) return;
    set({ view: v, back: [...get().back.slice(-30), cur] });
  },
  goBack: () => {
    const back = [...get().back];
    const prev = back.pop();
    if (prev) set({ view: prev, back });
  },

  selectedTodoId: null,
  openTodo: (id) => set({ selectedTodoId: id }),

  pendingRename: null,
  requestRename: (treeId) => set({ pendingRename: treeId }),

  quickAdd: { open: false, defaults: {} },
  openQuickAdd: (defaults = {}) => set({ quickAdd: { open: true, defaults } }),
  closeQuickAdd: () => set({ quickAdd: { open: false, defaults: {} } }),

  settings: DEFAULT_SETTINGS,
  initSettings: (s) => set({ settings: s }),
  updateSetting: async (key, value) => {
    set({ settings: { ...get().settings, [key]: value } });
    await saveSetting(ctx().sql, key, value);
  },
}));
