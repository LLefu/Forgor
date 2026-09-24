import type { SqlDriver } from "@/platform/types";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  archiveAfterDays: 7,
  hotkey: navigatorIsMac() ? "CommandOrControl+Shift+Space" : "Control+Alt+Space",
  vaultPath: null,
  upcomingDays: 14,
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
  return out;
}

export async function saveSetting<K extends keyof Settings>(sql: SqlDriver, key: K, value: Settings[K]) {
  await sql.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}
