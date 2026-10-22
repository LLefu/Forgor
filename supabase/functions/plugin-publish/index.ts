// POST a plugin zip (body, Content-Type application/zip) to publish it, or a new version of it.
// The first upload of an id answers with a publish key; new versions need it in the
// `x-publish-key` header. Answers { id, version, publishKey? } or { error }.
import { strFromU8, unzipSync, zipSync } from "npm:fflate@0.8.2";
import { admin, caller, limit, newer, PLUGIN_ID, Refused, serve, sha256, json, VERSION } from "../_shared/store.ts";

const MAX_ZIP = 5 * 1024 * 1024;
const FILES = ["manifest.json", "main.js", "styles.css", "icon.png", "icon.svg"] as const;
/** The built-in plugins' ids, and the app's name. */
const RESERVED = new Set(["meetings", "writing", "jira", "bitbucket", "forgor"]);

interface Manifest {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  author?: unknown;
  description?: unknown;
  minAppVersion?: unknown;
}

const text = (v: unknown, field: string, max: number, required = true) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new Refused(400, `manifest.json needs "${field}".`);
  if (s.length > max) throw new Refused(400, `"${field}" in manifest.json is too long (at most ${max} characters).`);
  return s;
};

serve(async (req) => {
  const db = admin();
  const who = await caller(req);
  await limit(db, `publish:${who}`, 3600, 20, "Too many uploads from here for now. Try again in an hour.");

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_ZIP) throw new Refused(413, "The zip is too big (at most 5 MB).");
  const zip = new Uint8Array(await req.arrayBuffer());
  if (!zip.length) throw new Refused(400, "No zip was sent.");
  if (zip.length > MAX_ZIP) throw new Refused(413, "The zip is too big (at most 5 MB).");

  // ---- read and check the plugin
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new Refused(400, "That isn't a valid zip file.");
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith("/") && !n.startsWith("__MACOSX/"));
  const manifestPath = names.filter((n) => n.split("/").pop() === "manifest.json").sort((a, b) => a.split("/").length - b.split("/").length)[0];
  if (!manifestPath) throw new Refused(400, "The zip has no manifest.json.");
  const base = manifestPath.slice(0, -"manifest.json".length);
  const files: Record<string, Uint8Array> = {};
  for (const name of FILES) if (entries[base + name]) files[name] = entries[base + name];
  if (!files["main.js"]) throw new Refused(400, "The zip has no main.js (build the plugin first).");
  if (files["icon.png"] && files["icon.png"].length > 256 * 1024) throw new Refused(400, "icon.png is too big (at most 256 KB).");
  if (files["icon.svg"] && files["icon.svg"].length > 128 * 1024) throw new Refused(400, "icon.svg is too big (at most 128 KB).");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
  } catch {
    throw new Refused(400, "manifest.json isn't valid JSON.");
  }
  const id = text(manifest.id, "id", 64);
  if (!PLUGIN_ID.test(id)) throw new Refused(400, `"${id}" isn't a valid plugin id (lowercase letters, digits and dashes).`);
  if (RESERVED.has(id)) throw new Refused(400, `"${id}" is reserved. Choose another id.`);
  const version = text(manifest.version, "version", 20);
  if (!VERSION.test(version)) throw new Refused(400, `The version must look like 1.0.0 (it is "${version}").`);
  const name = text(manifest.name, "name", 80);
  const author = text(manifest.author, "author", 80);
  const description = text(manifest.description, "description", 500, false);
  const minAppVersion = typeof manifest.minAppVersion === "string" && VERSION.test(manifest.minAppVersion) ? manifest.minAppVersion : null;

  // ---- who may publish this id
  const { data: existing, error: readError } = await db.from("plugins").select("id, latest_version, removed_at").eq("id", id).maybeSingle();
  if (readError) throw readError;
  let publishKey: string | undefined;
  if (existing) {
    if (existing.removed_at) throw new Refused(403, "This plugin was removed from the store.");
    const key = req.headers.get("x-publish-key") ?? "";
    const { data: stored } = await db.from("plugin_keys").select("key_hash").eq("plugin_id", id).maybeSingle();
    if (!key || !stored || (await sha256(key)) !== stored.key_hash) throw new Refused(403, `"${id}" is already in the store. To publish a new version you need its publish key.`);
    if (!newer(version, existing.latest_version)) throw new Refused(409, `The store already has version ${existing.latest_version}. Raise the version in manifest.json.`);
  } else {
    publishKey = `fpk_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  }

  // ---- store a clean zip (only the plugin's own files, at the top) and the icon
  const clean = zipSync(files, { level: 9, mtime: new Date("2000-01-01") });
  const hash = await sha256(clean);
  const path = `p/${id}/${version}.zip`;
  // upsert: a published version can never be uploaded again (checked above); this only replaces a half-finished earlier try.
  const upload = await db.storage.from("plugins").upload(path, clean, { contentType: "application/zip", upsert: true });
  if (upload.error) throw upload.error;
  let iconPath: string | null = null;
  const icon = files["icon.png"] ? { ext: "png", type: "image/png", bytes: files["icon.png"] } : files["icon.svg"] ? { ext: "svg", type: "image/svg+xml", bytes: files["icon.svg"] } : null;
  if (icon) {
    iconPath = `icons/${id}-${version}.${icon.ext}`;
    const up = await db.storage.from("plugins").upload(iconPath, icon.bytes, { contentType: icon.type, upsert: true });
    if (up.error) iconPath = null;
  }

  // ---- the list (an update points at its version only once that exists; a new plugin is undone if a step fails)
  const row = { name, author, description, latest_version: version, icon_path: iconPath, updated_at: new Date().toISOString() };
  const versionRow = { plugin_id: id, version, path, sha256: hash, size: clean.length, min_app_version: minAppVersion };
  if (existing) {
    const added = await db.from("plugin_versions").insert(versionRow);
    if (added.error) throw added.error;
    const { error } = await db.from("plugins").update(row).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await db.from("plugins").insert({ id, ...row });
    if (error) {
      await db.storage.from("plugins").remove([path]);
      // Someone published the same id a moment ago.
      if (error.code === "23505") throw new Refused(409, `"${id}" was just taken. Choose another id.`);
      throw error;
    }
    try {
      const keyRow = await db.from("plugin_keys").insert({ plugin_id: id, key_hash: await sha256(publishKey!) });
      if (keyRow.error) throw keyRow.error;
      const added = await db.from("plugin_versions").insert(versionRow);
      if (added.error) throw added.error;
    } catch (e) {
      await db.from("plugins").delete().eq("id", id); // keys and versions go with it
      await db.storage.from("plugins").remove([path]);
      throw e;
    }
  }

  return json({ id, version, ...(publishKey ? { publishKey } : {}) }, existing ? 200 : 201);
});
