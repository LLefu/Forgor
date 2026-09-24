import initSqlJs, { type Database } from "sql.js";
import type { FsEntry, Platform, SqlDriver, SqlValue, VaultFs } from "./types";

/** sql.js driver: used in the browser (dev/demo/e2e) and in unit tests. */
export class SqlJsDriver implements SqlDriver {
  constructor(private db: Database) {}

  static async create(locateFile?: (file: string) => string): Promise<SqlJsDriver> {
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    return new SqlJsDriver(new SQL.Database());
  }

  async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<void> {
    if (params.length === 0) this.db.exec(sql);
    else this.db.run(sql, params);
  }
}

/** In-memory vault. Files are kept in a Map; directories are tracked explicitly. */
export class MemoryVault implements VaultFs {
  readonly rootLabel = "In-memory vault (browser)";
  private files = new Map<string, string | Uint8Array>();
  private dirs = new Set<string>();
  private listeners = new Set<() => void>();
  private blobUrls = new Map<string, string>();

  private ensureParents(path: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }

  async list(): Promise<FsEntry[]> {
    return [
      ...[...this.dirs].map((path) => ({ path, isDir: true })),
      ...[...this.files.keys()].map((path) => ({ path, isDir: false })),
    ];
  }
  async exists(path: string) {
    return this.files.has(path) || this.dirs.has(path);
  }
  async readText(path: string) {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`File not found: ${path}`);
    return typeof f === "string" ? f : new TextDecoder().decode(f);
  }
  async writeText(path: string, text: string) {
    this.ensureParents(path);
    this.files.set(path, text);
  }
  async writeBinary(path: string, data: Uint8Array) {
    this.ensureParents(path);
    this.files.set(path, data);
    this.blobUrls.delete(path);
  }
  async mkdir(path: string) {
    this.ensureParents(path);
    this.dirs.add(path);
  }
  async rename(from: string, to: string) {
    const moves: [string, string][] = [];
    for (const k of this.files.keys()) {
      if (k === from || k.startsWith(from + "/")) moves.push([k, to + k.slice(from.length)]);
    }
    for (const [a, b] of moves) {
      const v = this.files.get(a)!;
      this.files.delete(a);
      this.ensureParents(b);
      this.files.set(b, v);
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(from + "/")) {
        this.dirs.delete(d);
        this.dirs.add(to + d.slice(from.length));
      }
    }
    this.ensureParents(to);
  }
  async remove(path: string) {
    for (const k of [...this.files.keys()]) if (k === path || k.startsWith(path + "/")) this.files.delete(k);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(path + "/")) this.dirs.delete(d);
  }
  fileUrl(path: string): string {
    const cached = this.blobUrls.get(path);
    if (cached) return cached;
    const f = this.files.get(path);
    if (f === undefined || typeof URL.createObjectURL !== "function") return "";
    const bytes = typeof f === "string" ? new TextEncoder().encode(f) : f;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    this.blobUrls.set(path, url);
    return url;
  }
  async watch(onChange: () => void) {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
  /** Test helper: simulate an external edit. */
  emitChange() {
    this.listeners.forEach((l) => l());
  }
}

export async function createMemoryPlatform(opts?: { locateFile?: (f: string) => string }): Promise<Platform> {
  const sql = await SqlJsDriver.create(opts?.locateFile);
  return {
    kind: "memory",
    sql,
    vault: null,
    pickVaultFolder: async () => "memory://vault",
    openVault: async () => new MemoryVault(),
    defaultVaultPath: async () => "memory://vault",
  };
}
