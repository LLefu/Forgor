import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { Platform, VaultFs } from "@/platform/types";
import { createMemoryPlatform, MemoryVault } from "@/platform/memory";
import { isTauri } from "@/platform/env";
import { migrate } from "@/data/schema";
import { loadSettings, saveSetting } from "@/data/settings";
import { setCtx } from "@/data/context";
import { syncVault } from "@/data/notes";
import { archiveCompleted } from "@/data/todos";
import type { Settings } from "@/data/types";
import { seedDemo } from "./demo";

export interface BootResult {
  platform: Platform;
  settings: Settings;
  /** True when the user still has to choose a vault folder (desktop first run). */
  needsVault: boolean;
}

let platformPromise: Promise<Platform> | null = null;

function getPlatform(): Promise<Platform> {
  platformPromise ??= (async () => {
    if (isTauri()) {
      const { createTauriPlatform } = await import("@/platform/tauri");
      return createTauriPlatform();
    }
    return createMemoryPlatform({ locateFile: () => wasmUrl });
  })();
  return platformPromise;
}

let bootPromise: Promise<BootResult> | null = null;

/** Idempotent: React StrictMode (and HMR) may call this more than once. */
export function boot(): Promise<BootResult> {
  bootPromise ??= doBoot();
  return bootPromise;
}

async function doBoot(): Promise<BootResult> {
  const platform = await getPlatform();
  await migrate(platform.sql);
  const settings = await loadSettings(platform.sql);

  if (platform.kind === "memory") {
    const vault = new MemoryVault();
    await activateVault(platform, vault, settings);
    if (!new URLSearchParams(location.search).has("empty")) await seedDemo();
    // Browser/dev only: lets e2e tests inspect the in-memory files and database.
    (window as unknown as { __wn: unknown }).__wn = { vault, sql: platform.sql };
    return { platform, settings, needsVault: false };
  }

  if (!settings.vaultPath) return { platform, settings, needsVault: true };
  const vault = await platform.openVault(settings.vaultPath);
  await activateVault(platform, vault, settings);
  return { platform, settings, needsVault: false };
}

/**
 * Popup window boot: same database, same vault, but no watcher or background
 * jobs (the main window owns those).
 */
let popupPromise: Promise<Settings> | null = null;

export function bootPopup(): Promise<Settings> {
  popupPromise ??= doBootPopup();
  return popupPromise;
}

async function doBootPopup(): Promise<Settings> {
  const platform = await getPlatform();
  await migrate(platform.sql);
  const settings = await loadSettings(platform.sql);
  if (platform.kind === "memory") {
    const vault = new MemoryVault();
    platform.vault = vault;
    setCtx({ sql: platform.sql, vault });
    await seedDemo();
  } else if (settings.vaultPath) {
    const vault = await platform.openVault(settings.vaultPath);
    platform.vault = vault;
    setCtx({ sql: platform.sql, vault });
  } else {
    throw new Error("Open Work Notes once to choose a notes folder first.");
  }
  return settings;
}

let stopWatching: (() => void) | null = null;
let archiveTimer: ReturnType<typeof setInterval> | null = null;

async function activateVault(platform: Platform, vault: VaultFs, settings: Settings) {
  platform.vault = vault;
  setCtx({ sql: platform.sql, vault });
  await syncVault();
  stopWatching?.();
  stopWatching = await vault.watch(() => void syncVault());
  await archiveCompleted(settings.archiveAfterDays);
  if (archiveTimer) clearInterval(archiveTimer);
  archiveTimer = setInterval(async () => {
    const s = await loadSettings(platform.sql);
    await archiveCompleted(s.archiveAfterDays);
  }, 60 * 60 * 1000);
}

/** Switch to (or initialise) a vault folder chosen by the user. */
export async function chooseVault(platform: Platform, absPath: string): Promise<void> {
  // The index belongs to one vault; clear it before switching.
  if (platform.vault) {
    for (const t of ["notes", "notes_fts", "note_links", "folders"]) await platform.sql.execute(`DELETE FROM ${t}`);
  }
  await saveSetting(platform.sql, "vaultPath", absPath);
  const settings = await loadSettings(platform.sql);
  const vault = await platform.openVault(absPath);
  await activateVault(platform, vault, settings);
}
