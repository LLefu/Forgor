/**
 * Platform primitives. Everything above this layer (services, UI) only talks
 * to these two interfaces, so the app runs identically on the Tauri desktop
 * shell and in a plain browser / test runner (in-memory implementations).
 */

export type SqlValue = string | number | null;

export interface SqlDriver {
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<void>;
}

export interface FsEntry {
  /** Path relative to the vault root, always with "/" separators. */
  path: string;
  isDir: boolean;
}

/** All paths are relative to the vault root and use "/" separators. */
export interface VaultFs {
  /** Human-readable absolute location of the vault (for display). */
  readonly rootLabel: string;
  /** Recursive listing of everything in the vault (excluding the root itself). */
  list(): Promise<FsEntry[]>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** A URL an <img> tag can load for a file inside the vault. */
  fileUrl(path: string): string;
  /** Calls back (debounced) whenever something in the vault changes on disk. */
  watch(onChange: () => void): Promise<() => void>;
}

export interface Platform {
  kind: "tauri" | "memory";
  sql: SqlDriver;
  vault: VaultFs | null;
  /** Ask the user to pick a vault folder. Returns an absolute path or null. */
  pickVaultFolder(): Promise<string | null>;
  openVault(absPath: string): Promise<VaultFs>;
  defaultVaultPath(): Promise<string>;
}
