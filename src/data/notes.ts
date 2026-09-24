import { ctx, emitChange } from "./context";
import type { Folder, NoteMeta } from "./types";
import { parseNote, stringifyNote } from "@/lib/frontmatter";
import { extractWikiLinks } from "@/lib/wikilinks";
import {
  ATTACHMENTS_DIR,
  TRASH_DIR,
  basename,
  dirname,
  isIgnoredPath,
  joinPath,
  relativePath,
  resolvePath,
  sanitizeName,
  stripMd,
  uniqueName,
} from "@/lib/paths";
import { newId, nowIso } from "@/lib/utils";

interface NoteRow {
  rid: number;
  id: string;
  path: string;
  title: string;
  folder_id: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

const toMeta = (r: NoteRow): NoteMeta => ({
  id: r.id,
  path: r.path,
  title: r.title,
  folderId: r.folder_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---------------------------------------------------------------- queries

export async function listFolders(): Promise<Folder[]> {
  return ctx().sql.select<Folder>(`SELECT id, path FROM folders ORDER BY path COLLATE NOCASE`);
}

export async function listNotes(): Promise<NoteMeta[]> {
  const rows = await ctx().sql.select<NoteRow>(`SELECT * FROM notes ORDER BY path COLLATE NOCASE`);
  return rows.map(toMeta);
}

export async function getNoteMeta(id: string): Promise<NoteMeta | null> {
  const rows = await ctx().sql.select<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
  return rows[0] ? toMeta(rows[0]) : null;
}

export async function folderIdForPath(path: string): Promise<string | null> {
  if (!path) return null;
  const rows = await ctx().sql.select<{ id: string }>(`SELECT id FROM folders WHERE path = ?`, [path]);
  return rows[0]?.id ?? null;
}

export async function folderPathForId(id: string | null): Promise<string> {
  if (!id) return "";
  const rows = await ctx().sql.select<{ path: string }>(`SELECT path FROM folders WHERE id = ?`, [id]);
  return rows[0]?.path ?? "";
}

// ---------------------------------------------------------------- index helpers

async function ensureFolderRow(path: string): Promise<string | null> {
  if (!path) return null;
  const existing = await folderIdForPath(path);
  if (existing) return existing;
  // Make sure parents exist too.
  await ensureFolderRow(dirname(path));
  const id = newId();
  await ctx().sql.execute(`INSERT INTO folders (id, path) VALUES (?, ?)`, [id, path]);
  return id;
}

async function writeIndex(row: Omit<NoteRow, "rid">): Promise<void> {
  const { sql } = ctx();
  await sql.execute(
    `INSERT INTO notes (id, path, title, folder_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET path = excluded.path, title = excluded.title, folder_id = excluded.folder_id,
       content = excluded.content, updated_at = excluded.updated_at`,
    [row.id, row.path, row.title, row.folder_id, row.content, row.created_at, row.updated_at],
  );
  const [{ rid }] = await sql.select<{ rid: number }>(`SELECT rid FROM notes WHERE id = ?`, [row.id]);
  await sql.execute(`DELETE FROM notes_fts WHERE docid = ?`, [rid]);
  await sql.execute(`INSERT INTO notes_fts (docid, title, content) VALUES (?, ?, ?)`, [rid, row.title, row.content]);
  await sql.execute(`DELETE FROM note_links WHERE source_id = ?`, [row.id]);
  for (const target of extractWikiLinks(row.content)) {
    await sql.execute(`INSERT OR IGNORE INTO note_links (source_id, target) VALUES (?, ?)`, [row.id, target]);
  }
}

async function dropIndex(id: string): Promise<void> {
  const { sql } = ctx();
  const rows = await sql.select<{ rid: number }>(`SELECT rid FROM notes WHERE id = ?`, [id]);
  if (rows[0]) await sql.execute(`DELETE FROM notes_fts WHERE docid = ?`, [rows[0].rid]);
  await sql.execute(`DELETE FROM notes WHERE id = ?`, [id]);
  await sql.execute(`DELETE FROM note_links WHERE source_id = ?`, [id]);
}

// ---------------------------------------------------------------- sync

let syncing: Promise<void> | null = null;
let syncAgain = false;

/**
 * Bring the SQLite index in line with the files on disk. Safe to call often:
 * concurrent calls are coalesced. Files without a frontmatter `id` get one.
 */
export function syncVault(): Promise<void> {
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = (async () => {
    try {
      do {
        syncAgain = false;
        await doSync();
      } while (syncAgain);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function doSync(): Promise<void> {
  const { sql, vault } = ctx();
  const entries = (await vault.list()).filter((e) => !isIgnoredPath(e.path));
  let changed = false;

  // Folders
  const diskDirs = new Set(entries.filter((e) => e.isDir).map((e) => e.path));
  const dbFolders = await listFolders();
  for (const f of dbFolders) {
    if (!diskDirs.has(f.path)) {
      await sql.execute(`DELETE FROM folders WHERE id = ?`, [f.id]);
      await sql.execute(`UPDATE todos SET folder_id = NULL WHERE folder_id = ?`, [f.id]);
      changed = true;
    }
  }
  const known = new Set(dbFolders.map((f) => f.path));
  for (const d of [...diskDirs].sort()) {
    if (!known.has(d)) {
      await ensureFolderRow(d);
      changed = true;
    }
  }

  // Notes
  const dbNotes = await sql.select<NoteRow>(`SELECT * FROM notes`);
  const byId = new Map(dbNotes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const mdFiles = entries.filter((e) => !e.isDir && e.path.toLowerCase().endsWith(".md"));

  for (const file of mdFiles) {
    let text: string;
    try {
      text = await vault.readText(file.path);
    } catch {
      continue; // file vanished mid-sync
    }
    const parsed = parseNote(text);
    let id = typeof parsed.data.id === "string" ? parsed.data.id : null;

    // Missing or duplicate id (e.g. a copied file): assign a fresh one and write it back.
    if (!id || seen.has(id)) {
      id = newId();
      const data = { id, created: typeof parsed.data.created === "string" ? parsed.data.created : nowIso(), ...withoutId(parsed.data) };
      await vault.writeText(file.path, stringifyNote(data, parsed.body));
    }
    seen.add(id);

    const existing = byId.get(id);
    const title = stripMd(basename(file.path));
    const folderId = await ensureFolderRow(dirname(file.path));
    if (existing && existing.path === file.path && existing.content === parsed.body && existing.folder_id === folderId) continue;

    await writeIndex({
      id,
      path: file.path,
      title,
      folder_id: folderId,
      content: parsed.body,
      created_at: existing?.created_at ?? (typeof parsed.data.created === "string" ? parsed.data.created : nowIso()),
      updated_at: existing && existing.content === parsed.body ? existing.updated_at : nowIso(),
    });
    changed = true;
  }

  for (const n of dbNotes) {
    if (!seen.has(n.id)) {
      await dropIndex(n.id);
      changed = true;
    }
  }

  if (changed) emitChange("notes", "folders", "todos");
}

function withoutId(data: Record<string, unknown>) {
  const { id: _id, created: _created, ...rest } = data;
  return rest;
}

// ---------------------------------------------------------------- note CRUD

export interface OpenedNote {
  meta: NoteMeta;
  data: Record<string, unknown>;
  body: string;
}

export async function readNote(id: string): Promise<OpenedNote | null> {
  const meta = await getNoteMeta(id);
  if (!meta) return null;
  let text: string;
  try {
    text = await ctx().vault.readText(meta.path);
  } catch {
    return null; // moved/deleted on disk and the index hasn't caught up yet
  }
  const { data, body } = parseNote(text);
  return { meta, data, body };
}

export async function createNote(folderPath: string, title = "Untitled", body = ""): Promise<NoteMeta> {
  const { vault } = ctx();
  const path = await uniqueName(folderPath, sanitizeName(title), ".md", (p) => vault.exists(p));
  const id = newId();
  const created = nowIso();
  await vault.writeText(path, stringifyNote({ id, created }, body));
  await writeIndex({
    id,
    path,
    title: stripMd(basename(path)),
    folder_id: await ensureFolderRow(folderPath),
    content: body,
    created_at: created,
    updated_at: created,
  });
  emitChange("notes", "folders");
  return (await getNoteMeta(id))!;
}

/**
 * Persist a note body. Frontmatter is preserved. Returns the updated meta.
 * Callers that need inline-todo syncing should use `saveNote` in inlineSync.ts.
 */
export async function writeNoteBody(id: string, body: string): Promise<NoteMeta | null> {
  const { vault, sql } = ctx();
  const rows = await sql.select<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
  const row = rows[0];
  if (!row) return null;
  let data: Record<string, unknown> = { id, created: row.created_at };
  try {
    data = { ...parseNote(await vault.readText(row.path)).data, id };
  } catch {
    // file missing: recreate with minimal frontmatter
  }
  await vault.writeText(row.path, stringifyNote(data, body));
  await writeIndex({ ...row, content: body, updated_at: nowIso() });
  emitChange("notes");
  return getNoteMeta(id);
}

export async function renameNote(id: string, newTitle: string): Promise<NoteMeta | null> {
  const meta = await getNoteMeta(id);
  if (!meta) return null;
  const { vault } = ctx();
  const name = sanitizeName(newTitle);
  if (name === meta.title) return meta;
  const dir = dirname(meta.path);
  const target =
    name.toLowerCase() === meta.title.toLowerCase()
      ? joinPath(dir, name + ".md") // case-only rename
      : await uniqueName(dir, name, ".md", (p) => vault.exists(p));
  await vault.rename(meta.path, target);
  await updateNotePath(id, target);
  emitChange("notes");
  return getNoteMeta(id);
}

export async function moveNote(id: string, folderPath: string): Promise<NoteMeta | null> {
  const meta = await getNoteMeta(id);
  if (!meta || dirname(meta.path) === folderPath) return meta;
  const { vault } = ctx();
  const target = await uniqueName(folderPath, meta.title, ".md", (p) => vault.exists(p));
  await vault.rename(meta.path, target);
  await updateNotePath(id, target);
  await relocateAttachments(id, dirname(meta.path), folderPath);
  emitChange("notes", "folders");
  return getNoteMeta(id);
}

const LINK_RE = /(!?\[[^\]]*\]\()([^)\s]+)(\))/g;

/**
 * After a note moves to another folder, move the attachments it references
 * (files in the old folder's _attachments) along and rewrite the links.
 */
async function relocateAttachments(noteId: string, fromDir: string, toDir: string) {
  const { vault } = ctx();
  const opened = await readNote(noteId);
  if (!opened) return;
  const replacements = new Map<string, string>();
  for (const m of opened.body.matchAll(LINK_RE)) {
    const url = m[2];
    if (/^[a-z]+:/i.test(url) || replacements.has(url)) continue;
    const oldPath = resolvePath(fromDir, url);
    if (!oldPath.split("/").includes(ATTACHMENTS_DIR) || !(await vault.exists(oldPath))) continue;
    const name = basename(oldPath);
    const dot = name.lastIndexOf(".");
    const newPath = await uniqueName(joinPath(toDir, ATTACHMENTS_DIR), dot > 0 ? name.slice(0, dot) : name, dot > 0 ? name.slice(dot) : "", (p) =>
      vault.exists(p),
    );
    await vault.rename(oldPath, newPath);
    replacements.set(url, encodeURI(relativePath(toDir, newPath)));
  }
  if (!replacements.size) return;
  const body = opened.body.replace(LINK_RE, (all, pre: string, url: string, post: string) =>
    replacements.has(url) ? pre + replacements.get(url) + post : all,
  );
  await writeNoteBody(noteId, body);
}

async function updateNotePath(id: string, path: string) {
  const { sql } = ctx();
  const folderId = await ensureFolderRow(dirname(path));
  await sql.execute(`UPDATE notes SET path = ?, title = ?, folder_id = ? WHERE id = ?`, [path, stripMd(basename(path)), folderId, id]);
  const [{ rid, content }] = await sql.select<{ rid: number; content: string }>(`SELECT rid, content FROM notes WHERE id = ?`, [id]);
  await sql.execute(`DELETE FROM notes_fts WHERE docid = ?`, [rid]);
  await sql.execute(`INSERT INTO notes_fts (docid, title, content) VALUES (?, ?, ?)`, [rid, stripMd(basename(path)), content]);
}

// ---------------------------------------------------------------- folder CRUD

export async function createFolder(parentPath: string, name = "New folder"): Promise<Folder> {
  const { vault } = ctx();
  const path = await uniqueName(parentPath, sanitizeName(name), "", (p) => vault.exists(p));
  await vault.mkdir(path);
  const id = (await ensureFolderRow(path))!;
  emitChange("folders");
  return { id, path };
}

/** Rename or move a folder. `newPath` is the full new vault-relative path. */
export async function relocateFolder(id: string, newPath: string): Promise<Folder | null> {
  const { vault, sql } = ctx();
  const oldPath = await folderPathForId(id);
  if (!oldPath || oldPath === newPath) return oldPath ? { id, path: oldPath } : null;
  if (newPath === oldPath || newPath.startsWith(oldPath + "/")) throw new Error("Cannot move a folder into itself");
  const caseOnly = newPath.toLowerCase() === oldPath.toLowerCase();
  const target = caseOnly ? newPath : await uniqueName(dirname(newPath), basename(newPath), "", (p) => vault.exists(p));
  await vault.rename(oldPath, target);

  // Re-point folder rows and note rows under the old prefix; ids stay stable.
  const folders = await listFolders();
  for (const f of folders) {
    if (f.path === oldPath || f.path.startsWith(oldPath + "/")) {
      await sql.execute(`UPDATE folders SET path = ? WHERE id = ?`, [target + f.path.slice(oldPath.length), f.id]);
    }
  }
  await ensureFolderRow(dirname(target));
  const notes = await sql.select<{ id: string; path: string }>(`SELECT id, path FROM notes WHERE path LIKE ? ESCAPE '\\'`, [
    likePrefix(oldPath) + "/%",
  ]);
  for (const n of notes) await sql.execute(`UPDATE notes SET path = ? WHERE id = ?`, [target + n.path.slice(oldPath.length), n.id]);
  emitChange("folders", "notes");
  return { id, path: target };
}

function likePrefix(s: string) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

// ---------------------------------------------------------------- trash

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function trashNote(id: string): Promise<void> {
  const meta = await getNoteMeta(id);
  if (!meta) return;
  const { vault, sql } = ctx();
  const trashPath = joinPath(TRASH_DIR, `${stamp()}-${id}`, basename(meta.path));
  await vault.rename(meta.path, trashPath);
  await sql.execute(`INSERT INTO trash (id, kind, title, original_path, trash_path, deleted_at) VALUES (?, 'note', ?, ?, ?, ?)`, [
    newId(),
    meta.title,
    meta.path,
    trashPath,
    nowIso(),
  ]);
  await dropIndex(id);
  emitChange("notes", "trash", "todos");
}

export async function trashFolder(id: string): Promise<void> {
  const path = await folderPathForId(id);
  if (!path) return;
  const { vault, sql } = ctx();
  const trashPath = joinPath(TRASH_DIR, `${stamp()}-${id}`, basename(path));
  await vault.rename(path, trashPath);
  await sql.execute(`INSERT INTO trash (id, kind, title, original_path, trash_path, deleted_at) VALUES (?, 'folder', ?, ?, ?, ?)`, [
    newId(),
    basename(path),
    path,
    trashPath,
    nowIso(),
  ]);
  await syncVault();
  emitChange("folders", "notes", "trash", "todos");
}

// ---------------------------------------------------------------- attachments

/** Save a pasted/dropped file next to the note and return a relative markdown link target. */
export async function saveAttachment(noteId: string, fileName: string, data: Uint8Array): Promise<{ rel: string; path: string }> {
  const meta = await getNoteMeta(noteId);
  if (!meta) throw new Error("Note not found");
  const { vault } = ctx();
  const dir = dirname(meta.path);
  const dot = fileName.lastIndexOf(".");
  const base = sanitizeName(dot > 0 ? fileName.slice(0, dot) : fileName);
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  const path = await uniqueName(joinPath(dir, ATTACHMENTS_DIR), base, ext, (p) => vault.exists(p));
  await vault.writeBinary(path, data);
  return { rel: encodeURI(relativePath(dir, path)), path };
}

// ---------------------------------------------------------------- backlinks

export async function backlinks(noteId: string): Promise<NoteMeta[]> {
  const meta = await getNoteMeta(noteId);
  if (!meta) return [];
  const rows = await ctx().sql.select<NoteRow>(
    `SELECT DISTINCT n.* FROM note_links l JOIN notes n ON n.id = l.source_id
     WHERE n.id != ? AND (lower(l.target) = lower(?) OR lower(l.target) = lower(?))
     ORDER BY n.title COLLATE NOCASE`,
    [noteId, meta.title, stripMd(meta.path)],
  );
  return rows.map(toMeta);
}
