import { ctx } from "./context";

/**
 * A plugin's own small data (its settings, covers…), in the settings table
 * under `plugin:<id>:<key>` as JSON. loadSettings ignores these rows. Not in
 * the notes folder: it stays on this computer.
 */
const rowKey = (pluginId: string, key: string) => `plugin:${pluginId}:${key}`;

export async function getPluginValue<T>(pluginId: string, key: string, fallback: T): Promise<T> {
  const rows = await ctx().sql.select<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [rowKey(pluginId, key)]);
  if (!rows.length) return fallback;
  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return fallback;
  }
}

export async function setPluginValue(pluginId: string, key: string, value: unknown): Promise<void> {
  await ctx().sql.execute(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [rowKey(pluginId, key), JSON.stringify(value)]);
}

/** Everything a plugin stored (when its data is deleted). */
export async function deletePluginValues(pluginId: string): Promise<void> {
  const prefix = `plugin:${pluginId}:`; // not LIKE: "_" in an id would match any character
  await ctx().sql.execute(`DELETE FROM settings WHERE substr(key, 1, ?) = ?`, [prefix.length, prefix]);
}
