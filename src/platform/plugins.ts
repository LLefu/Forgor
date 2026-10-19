import { isTauri } from "./env";

/**
 * Where community plugins live. A plugin is a folder with `manifest.json`,
 * `main.js` (one CommonJS bundle), and optionally `styles.css` and
 * `icon.png` / `icon.svg`: `<app data>/plugins/<id>/` on the desktop, in
 * memory in the browser build.
 */

export interface PluginBundle {
  /** Folder name (the plugin id for installed ones). */
  dir: string;
  source: "installed";
  manifest: string;
  main: string;
  styles?: string;
  /** Data URL. */
  icon?: string;
}

/** A plugin's files by name, as picked by the user (text for .json/.js/.css). */
export type PluginFiles = Record<string, string | Uint8Array>;

export const PLUGIN_FILES = ["manifest.json", "main.js", "styles.css", "icon.png", "icon.svg"] as const;

export interface PluginStore {
  list(): Promise<PluginBundle[]>;
  /** Copies the files into plugins/<id>/ (replacing an older version). */
  install(id: string, files: PluginFiles): Promise<void>;
  remove(id: string): Promise<void>;
  /** Asks for a .zip file and reads it; null when cancelled. */
  pickZip(): Promise<Uint8Array | null>;
  /** Saves a file where the user chooses (desktop) or downloads it (browser). */
  saveFile(defaultName: string, bytes: Uint8Array): Promise<void>;
  /** Shows the folder installed plugins live in (desktop only). */
  revealFolder?(): Promise<void>;
  /**
   * Writes a new project: asks where, then creates `<there>/<folderName>/` with
   * the files (desktop); the browser build downloads it as a zip. Returns the
   * folder's path (desktop), "" (downloaded), or null when cancelled.
   */
  createProject(folderName: string, files: Record<string, string>): Promise<string | null>;
  /** Opens a folder in Finder / Explorer (desktop only). */
  openFolder?(path: string): Promise<void>;
}

let local: PluginStore | null = null;

export function localPlugins(): PluginStore {
  local ??= isTauri() ? tauriStore() : memoryStore();
  return local;
}

// ---------------------------------------------------------------- desktop

function tauriStore(): PluginStore {
  const fs = () => import("@tauri-apps/plugin-fs");
  const root = async () => {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    return join(await appDataDir(), "plugins");
  };
  const readFolder = async (dir: string): Promise<PluginFiles> => {
    const { exists, readTextFile, readFile } = await fs();
    const { join } = await import("@tauri-apps/api/path");
    const out: PluginFiles = {};
    for (const name of PLUGIN_FILES) {
      const path = await join(dir, name);
      if (!(await exists(path))) continue;
      out[name] = name === "icon.png" ? await readFile(path) : await readTextFile(path);
    }
    return out;
  };
  return {
    list: async () => {
      const { exists, readDir } = await fs();
      const { join } = await import("@tauri-apps/api/path");
      const dir = await root();
      const installed: PluginBundle[] = [];
      if (await exists(dir)) {
        for (const entry of await readDir(dir)) {
          if (!entry.isDirectory) continue;
          const files = await readFolder(await join(dir, entry.name));
          installed.push(toBundle(entry.name, "installed", files));
        }
      }
      return installed;
    },
    install: async (id, files) => {
      const { mkdir, writeTextFile, writeFile } = await fs();
      const { join } = await import("@tauri-apps/api/path");
      const dir = await join(await root(), id);
      await mkdir(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        const path = await join(dir, name);
        if (typeof content === "string") await writeTextFile(path, content);
        else await writeFile(path, content);
      }
    },
    remove: async (id) => {
      const { exists, remove } = await fs();
      const { join } = await import("@tauri-apps/api/path");
      const dir = await join(await root(), id);
      if (await exists(dir)) await remove(dir, { recursive: true });
    },
    pickZip: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const file = await open({ title: "Choose a plugin (.zip)", filters: [{ name: "Plugin", extensions: ["zip"] }] });
      if (typeof file !== "string") return null;
      return (await fs()).readFile(file);
    },
    saveFile: async (defaultName, bytes) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: defaultName, filters: [{ name: "Plugin", extensions: ["zip"] }] });
      if (path) await (await fs()).writeFile(path, bytes);
    },
    // In Rust (src-tauri/src/access.rs): its own folder dialog, and it writes the files itself.
    createProject: async (folderName, files) => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string | null>("plugin_project_create", { folder: folderName, files });
    },
    openFolder: async (path) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_path", { path });
    },
    revealFolder: async () => {
      const { mkdir } = await fs();
      const dir = await root();
      await mkdir(dir, { recursive: true });
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_path", { path: dir });
    },
  };
}

// ---------------------------------------------------------------- browser build

function memoryStore(): PluginStore {
  const installed = new Map<string, PluginFiles>();
  return {
    list: async () => [...installed].map(([id, files]) => toBundle(id, "installed", files)),
    install: async (id, files) => void installed.set(id, { ...files }),
    remove: async (id) => void installed.delete(id),
    createProject: async (folderName, files) => {
      const { strToU8, zipSync } = await import("fflate");
      const zip = zipSync(Object.fromEntries(Object.entries(files).map(([file, text]) => [`${folderName}/${file}`, strToU8(text)])));
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      Object.assign(document.createElement("a"), { href: url, download: `${folderName}.zip` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return "";
    },
    pickZip: () =>
      pickFile(".zip,application/zip").then(async (file) => (file ? new Uint8Array(await file.arrayBuffer()) : null)),
    saveFile: async (defaultName, bytes) => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

// ----------------------------------------------------------------

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept });
    input.dataset.testid = "plugin-zip-input";
    input.style.display = "none";
    input.addEventListener("change", () => {
      input.remove();
      resolve(input.files?.[0] ?? null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** A bundle's files again (to export or publish it). */
export function bundleFiles(b: PluginBundle): PluginFiles {
  const files: PluginFiles = { "manifest.json": b.manifest, "main.js": b.main };
  if (b.styles) files["styles.css"] = b.styles;
  if (b.icon?.startsWith("data:image/png;base64,")) files["icon.png"] = Uint8Array.from(atob(b.icon.slice(22)), (c) => c.charCodeAt(0));
  else if (b.icon?.startsWith("data:image/svg+xml")) {
    const data = b.icon.slice(b.icon.indexOf(",") + 1);
    files["icon.svg"] = b.icon.includes(";base64,") ? new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))) : decodeURIComponent(data);
  }
  return files;
}

function toBundle(dir: string, source: PluginBundle["source"], files: PluginFiles): PluginBundle {
  const text = (name: string) => (typeof files[name] === "string" ? (files[name] as string) : undefined);
  const png = files["icon.png"];
  const svg = text("icon.svg");
  return {
    dir,
    source,
    manifest: text("manifest.json") ?? "",
    main: text("main.js") ?? "",
    styles: text("styles.css"),
    icon: png instanceof Uint8Array ? `data:image/png;base64,${toBase64(png)}` : svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined,
  };
}

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
