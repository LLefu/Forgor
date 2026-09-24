import Database from "@tauri-apps/plugin-sql";
import * as fs from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { documentDir, join, sep } from "@tauri-apps/api/path";
import type { FsEntry, Platform, SqlDriver, SqlValue, VaultFs } from "./types";

class TauriSqlDriver implements SqlDriver {
  constructor(private db: Database) {}
  select<T>(sql: string, params: SqlValue[] = []) {
    return this.db.select<T[]>(sql, params);
  }
  async execute(sql: string, params: SqlValue[] = []) {
    await this.db.execute(sql, params);
  }
}

/** Vault backed by a real folder on disk. */
class TauriVault implements VaultFs {
  constructor(
    private root: string,
    private separator: string,
  ) {}

  get rootLabel() {
    return this.root;
  }

  private abs(rel: string) {
    return rel ? this.root + this.separator + rel.split("/").join(this.separator) : this.root;
  }

  async list(): Promise<FsEntry[]> {
    const out: FsEntry[] = [];
    const walk = async (rel: string) => {
      const entries = await fs.readDir(this.abs(rel));
      for (const e of entries) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory) {
          out.push({ path: p, isDir: true });
          await walk(p);
        } else if (e.isFile) {
          out.push({ path: p, isDir: false });
        }
      }
    };
    await walk("");
    return out;
  }
  exists(path: string) {
    return fs.exists(this.abs(path));
  }
  readText(path: string) {
    return fs.readTextFile(this.abs(path));
  }
  private async ensureParent(path: string) {
    const idx = path.lastIndexOf("/");
    if (idx > 0) await fs.mkdir(this.abs(path.slice(0, idx)), { recursive: true });
  }
  async writeText(path: string, text: string) {
    await this.ensureParent(path);
    await fs.writeTextFile(this.abs(path), text);
  }
  async writeBinary(path: string, data: Uint8Array) {
    await this.ensureParent(path);
    await fs.writeFile(this.abs(path), data);
  }
  async mkdir(path: string) {
    await fs.mkdir(this.abs(path), { recursive: true });
  }
  async rename(from: string, to: string) {
    await this.ensureParent(to);
    await fs.rename(this.abs(from), this.abs(to));
  }
  async remove(path: string) {
    await fs.remove(this.abs(path), { recursive: true });
  }
  fileUrl(path: string) {
    return convertFileSrc(this.abs(path));
  }
  async watch(onChange: () => void) {
    return fs.watch(this.root, () => onChange(), { recursive: true, delayMs: 400 });
  }
}

export async function createTauriPlatform(): Promise<Platform> {
  const db = await Database.load("sqlite:worknotes.db");
  const separator = sep();
  return {
    kind: "tauri",
    sql: new TauriSqlDriver(db),
    vault: null,
    pickVaultFolder: async () => {
      const picked = await open({ directory: true, multiple: false, title: "Choose your notes folder" });
      return typeof picked === "string" ? picked : null;
    },
    openVault: async (absPath: string) => {
      await fs.mkdir(absPath, { recursive: true });
      return new TauriVault(absPath.replace(/[\\/]+$/, ""), separator);
    },
    defaultVaultPath: async () => join(await documentDir(), "Work Notes"),
  };
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
