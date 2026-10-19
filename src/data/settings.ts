import { DEFAULT_ACCENT } from "@/lib/accents";
import type { SqlDriver } from "@/platform/types";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  themeSoft: false,
  archiveAfterDays: 7,
  hotkey: navigatorIsMac() ? "CommandOrControl+Shift+Space" : "Control+Alt+Space",
  vaultPath: null,
  upcomingDays: 14,
  allTasksSort: "due",
  allTasksShowDone: false,
  accent: DEFAULT_ACCENT,
  customColors: [],
  sidebarWidth: 260,
  panelWidth: 400,
  zoom: 1,
  plugins: {},
  meetingsEnabled: false,
  meetingMic: null,
  meetingLanguage: "auto",
  writingEnabled: false,
  jiraEnabled: false,
  jiraAccount: null,
};

function navigatorIsMac() {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
}

/** Settings live in SQLite (app data dir), not in the vault. */
export async function loadSettings(sql: SqlDriver): Promise<Settings> {
  const rows = await sql.select<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out) {
      try {
        (out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
      } catch {
        // ignore corrupt value, keep default
      }
    }
  }
  // Up to 0.5.1 each feature had its own flag; they are plugins now.
  if (!rows.some((r) => r.key === "plugins")) out.plugins = legacyPlugins(out);
  return out;
}

/** The pre-plugin on/off flag of each built-in plugin (kept in step, see `plugins` in types.ts). */
export const LEGACY_FLAGS = { meetings: "meetingsEnabled", writing: "writingEnabled", jira: "jiraEnabled" } as const;

function legacyPlugins(s: Settings): Record<string, boolean> {
  return Object.fromEntries(Object.entries(LEGACY_FLAGS).map(([id, key]) => [id, s[key]]));
}

export async function saveSetting<K extends keyof Settings>(sql: SqlDriver, key: K, value: Settings[K]) {
  await sql.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}
