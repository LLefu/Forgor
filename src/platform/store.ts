import { isTauri } from "./env";

/**
 * The plugin store (Supabase project "Forgor": supabase/ in the repo). The list
 * and the zips are public; publishing, counting installs and reports go
 * through its edge functions. The publishable key below is meant to be in the
 * app (it only allows what the database's policies allow: reading the list).
 * The browser build (dev, e2e) uses an in-memory fake with the same behaviour.
 */
const URL_ = "https://ltqtoxulavqwhsxywxej.supabase.co";
const KEY = "sb_publishable_9jjI76AcEZ7AXTBAGrYkvA_pSnMtXjJ";

export interface StorePlugin {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  installs: number;
  /** Checked by Forgor's maintainer (e.g. Forgor's own plugins). */
  verified: boolean;
  iconUrl: string | null;
  /** The zip of the latest version. */
  url: string;
  sha256: string;
  size: number;
  minAppVersion: string | null;
  /** Taken out of the store, and why: the app turns it off where it's installed. */
  removed: string | null;
  updatedAt: string;
}

export interface PublishResult {
  id: string;
  version: string;
  /** Only on the first upload of an id: the key needed to publish new versions. */
  publishKey?: string;
}

export interface StoreApi {
  list(): Promise<StorePlugin[]>;
  download(plugin: StorePlugin): Promise<Uint8Array>;
  publish(zip: Uint8Array, publishKey: string | null): Promise<PublishResult>;
  countInstall(id: string): Promise<void>;
  report(id: string, reason: string): Promise<void>;
}

let api: StoreApi | null = null;

export function storeApi(): StoreApi {
  api ??= isTauri() ? realStore() : fakeStore();
  return api;
}

/** Browser build / tests only: use another store (e.g. a fake with content). */
export function setStoreApi(next: StoreApi) {
  api = next;
}

// ---------------------------------------------------------------- Supabase

interface Row {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  installs: number;
  verified: boolean;
  icon_path: string | null;
  path: string;
  sha256: string;
  size: number;
  min_app_version: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  updated_at: string;
}

const publicFile = (path: string) => `${URL_}/storage/v1/object/public/plugins/${path}`;

async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers: { apikey: KEY, ...init.headers } });
  } catch {
    throw new Error("Couldn't reach the plugin store. Check your internet connection.");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok) {
    // A paused free Supabase project answers 5xx (or 540) until it is resumed.
    if (res.status >= 500) throw new Error("The plugin store is unavailable right now. Try again later.");
    throw new Error(body?.error ?? body?.message ?? `The plugin store answered ${res.status}.`);
  }
  return body as T;
}

function realStore(): StoreApi {
  const fn = (name: string) => `${URL_}/functions/v1/${name}`;
  return {
    list: async () => {
      const rows = await call<Row[]>(`${URL_}/rest/v1/store_plugins?select=*&order=installs.desc,updated_at.desc`);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        author: r.author,
        description: r.description,
        version: r.version,
        installs: r.installs,
        verified: r.verified,
        iconUrl: r.icon_path ? publicFile(r.icon_path) : null,
        url: publicFile(r.path),
        sha256: r.sha256,
        size: r.size,
        minAppVersion: r.min_app_version,
        removed: r.removed_at ? r.removed_reason || "Removed from the store." : null,
        updatedAt: r.updated_at,
      }));
    },
    download: async (plugin) => {
      let res: Response;
      try {
        res = await fetch(plugin.url);
      } catch {
        throw new Error("Couldn't download the plugin. Check your internet connection.");
      }
      if (!res.ok) throw new Error(`Couldn't download the plugin (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    },
    publish: (zip, publishKey) =>
      call<PublishResult>(fn("plugin-publish"), {
        method: "POST",
        headers: { "Content-Type": "application/zip", ...(publishKey ? { "x-publish-key": publishKey } : {}) },
        body: zip as BodyInit,
      }),
    countInstall: async (id) => {
      await call(fn("plugin-install"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    },
    report: async (id, reason) => {
      await call(fn("plugin-report"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reason }) });
    },
  };
}

// ---------------------------------------------------------------- browser fake

/** In memory, behaving like the real store (publish keys, versions, removal). Starts empty. */
export function fakeStore(): StoreApi & { remove(id: string, reason: string): void; verify(id: string): void } {
  const plugins = new Map<string, { entry: StorePlugin; zip: Uint8Array; key: string }>();
  const newer = (a: string, b: string) => {
    const [pa, pb] = [a.split(".").map(Number), b.split(".").map(Number)];
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
    return false;
  };
  const sha = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    list: async () => [...plugins.values()].map((p) => ({ ...p.entry })).sort((a, b) => b.installs - a.installs),
    download: async (plugin) => {
      const p = plugins.get(plugin.id);
      if (!p) throw new Error("Couldn't download the plugin (404).");
      return p.zip;
    },
    publish: async (zip, publishKey) => {
      const { unzipPlugin } = await import("@/plugins/zip");
      const files = unzipPlugin(zip);
      const m = JSON.parse(String(files["manifest.json"])) as { id: string; name: string; author: string; description?: string; version: string; minAppVersion?: string };
      if (!/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error(`The version must look like 1.0.0 (it is "${m.version}").`);
      const existing = plugins.get(m.id);
      if (existing?.entry.removed) throw new Error("This plugin was removed from the store.");
      if (existing && existing.key !== publishKey) throw new Error(`"${m.id}" is already in the store. To publish a new version you need its publish key.`);
      if (existing && !newer(m.version, existing.entry.version)) throw new Error(`The store already has version ${existing.entry.version}. Raise the version in manifest.json.`);
      const key = existing?.key ?? `fpk_fake_${m.id}_${Math.random().toString(36).slice(2)}`;
      const entry: StorePlugin = {
        id: m.id,
        name: m.name,
        author: m.author,
        description: m.description ?? "",
        version: m.version,
        installs: existing?.entry.installs ?? 0,
        verified: false,
        iconUrl: null,
        url: `memory://store/${m.id}/${m.version}.zip`,
        sha256: await sha(zip),
        size: zip.length,
        minAppVersion: m.minAppVersion ?? null,
        removed: null,
        updatedAt: new Date().toISOString(),
      };
      plugins.set(m.id, { entry, zip, key });
      return { id: m.id, version: m.version, ...(existing ? {} : { publishKey: key }) };
    },
    countInstall: async (id) => {
      const p = plugins.get(id);
      if (p) p.entry.installs++;
    },
    report: async (id, reason) => {
      if (!plugins.has(id)) throw new Error("That plugin isn't in the store.");
      console.info(`Reported ${id}: ${reason}`);
    },
    remove: (id, reason) => {
      const p = plugins.get(id);
      if (p) p.entry.removed = reason;
    },
    verify: (id) => {
      const p = plugins.get(id);
      if (p) p.entry.verified = true;
    },
  };
}
