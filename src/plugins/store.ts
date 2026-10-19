import { create } from "zustand";
import { useUI } from "@/app/store";
import { showError } from "@/components/Toasts";
import { isTauri } from "@/platform/env";
import { secrets } from "@/platform/secrets";
import { storeApi, type StorePlugin } from "@/platform/store";
import { version as APP_VERSION } from "../../package.json";
import { installPlugin, pluginZip } from "./community";
import { PLUGINS } from "./registry";
import type { Plugin } from "./types";
import { unzipPlugin } from "./zip";

/**
 * The plugin store in the app: the list (refreshed on the Plugins page, at
 * startup and every 6 hours), installing and updating from it, publishing, and
 * the kill switch: a plugin taken out of the store is turned off wherever it
 * is installed.
 */
interface StoreState {
  plugins: StorePlugin[] | null;
  loading: boolean;
  error: string | null;
}

export const usePluginStore = create<StoreState>(() => ({ plugins: null, loading: false, error: null }));

/** The store's entry for a plugin id (null: not in the store, or not loaded yet). */
export const useStoreEntry = (id: string) => usePluginStore((s) => s.plugins?.find((p) => p.id === id) ?? null);

let pending: Promise<void> | null = null;

export function refreshStore(): Promise<void> {
  pending ??= (async () => {
    usePluginStore.setState({ loading: true });
    try {
      const plugins = await storeApi().list();
      usePluginStore.setState({ plugins, error: null });
      await applyRemovals(plugins);
    } catch (e) {
      usePluginStore.setState({ error: String((e as Error)?.message ?? e) });
    } finally {
      usePluginStore.setState({ loading: false });
      pending = null;
    }
  })();
  return pending;
}

/** Main window: check the store shortly after start and every 6 hours (updates, removed plugins). */
export function startStoreChecks(): () => void {
  const first = setTimeout(() => void refreshStore(), 10_000);
  const timer = setInterval(() => void refreshStore(), 6 * 60 * 60 * 1000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Turn off installed plugins that were taken out of the store (once each; they can be turned on again). */
async function applyRemovals(store: StorePlugin[]) {
  const ui = useUI.getState();
  for (const entry of store) {
    if (!entry.removed) continue;
    const local = PLUGINS.find((p) => p.id === entry.id && p.source === "installed");
    if (!local || !ui.settings.plugins[entry.id]) continue;
    const seenKey = `forgor.store.removed.${entry.id}`;
    try {
      if (localStorage.getItem(seenKey)) continue;
      localStorage.setItem(seenKey, "1");
    } catch {
      // no storage: turn it off each time
    }
    await ui.updateSetting("plugins", { ...useUI.getState().settings.plugins, [entry.id]: false });
    showError(`${local.name} was taken out of the plugin store and has been turned off. Reason: ${entry.removed}`, "Plugins");
  }
}

// ---------------------------------------------------------------- install / update

/** a > b for "x.y.z". */
export function newerVersion(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** The store has a newer version of this installed plugin. */
export function updateFor(plugin: Plugin, store: StorePlugin[] | null): StorePlugin | null {
  if (plugin.source !== "installed") return null;
  const entry = store?.find((p) => p.id === plugin.id);
  return entry && !entry.removed && newerVersion(entry.version, plugin.version) ? entry : null;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Download a plugin from the store, check it's the file the store lists, and install it (or update it). */
export async function installFromStore(entry: StorePlugin): Promise<Plugin> {
  if (entry.removed) throw new Error(`${entry.name} was taken out of the store.`);
  if (entry.minAppVersion && newerVersion(entry.minAppVersion, APP_VERSION)) throw new Error(`${entry.name} needs Forgor ${entry.minAppVersion} or newer (this is ${APP_VERSION}). Update Forgor first.`);
  const zip = await storeApi().download(entry);
  if ((await sha256(zip)) !== entry.sha256) throw new Error("The download doesn't match what the store lists (damaged or changed). Try again.");
  const plugin = await installPlugin(unzipPlugin(zip));
  void storeApi().countInstall(entry.id).catch(() => {});
  void refreshStore();
  return plugin;
}

// ---------------------------------------------------------------- publish / report

const keyName = (id: string) => `store:${id}`;

export const getPublishKey = (id: string) => secrets().get(keyName(id));

/**
 * Upload a community plugin (as it's loaded now) to the store. With no key the
 * id must be new: the store answers with a key, kept in this computer's
 * keychain for new versions. Returns that key on the first publish.
 */
export async function publishToStore(id: string, keyOverride?: string): Promise<{ version: string; newKey: string | null }> {
  const key = keyOverride?.trim() || (await getPublishKey(id));
  const result = await storeApi().publish(pluginZip(id), key);
  if (result.publishKey) await secrets().set(keyName(id), result.publishKey);
  else if (keyOverride?.trim()) await secrets().set(keyName(id), keyOverride.trim()); // a key from another computer worked: keep it
  void refreshStore();
  return { version: result.version, newKey: result.publishKey ?? null };
}

export const reportPlugin = (id: string, reason: string) => storeApi().report(id, reason);

/** Where publish keys are kept, for messages. */
export const keyPlace = () => (isTauri() ? "this computer's keychain" : "memory (browser build)");
