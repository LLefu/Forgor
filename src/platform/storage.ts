import { isTauri } from "./env";

export interface Usage {
  /** "notes", "attachments", "meetings", "trash", "database", "model:<id>", "recordings", "app-other", "cache". */
  id: string;
  path: string;
  bytes: number;
}

/** What Forgor stores on this device and where (desktop only; null in the browser build). */
export async function storageUsage(vaultRoot: string | null): Promise<Usage[] | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Usage[]>("storage_usage", { vault: vaultRoot });
}

/** Show a file or folder (absolute path) in Finder / Explorer. */
export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}
