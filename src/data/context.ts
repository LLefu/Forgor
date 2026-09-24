import type { SqlDriver, VaultFs } from "@/platform/types";

/**
 * The active storage context. Set once at boot (and when the vault changes).
 * Services read it via `ctx()`.
 */
interface Ctx {
  sql: SqlDriver;
  vault: VaultFs;
}

let current: Ctx | null = null;

export function setCtx(c: Ctx) {
  current = c;
}

export function ctx(): Ctx {
  if (!current) throw new Error("Storage not initialised");
  return current;
}

/** Listeners notified after any data mutation (UI uses this to refetch). */
type Topic = "notes" | "todos" | "folders" | "settings" | "trash" | "versions";
const listeners = new Set<(topics: Topic[]) => void>();

export function onDataChange(fn: (topics: Topic[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange(...topics: Topic[]) {
  listeners.forEach((l) => l(topics));
}
