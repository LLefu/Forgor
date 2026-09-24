import { ctx, emitChange } from "./context";
import type { NoteVersion, TrashItem } from "./types";
import { saveNote, snapshotNow } from "./noteSave";
import { purgeTodos, restoreTodos } from "./todos";
import { syncVault } from "./notes";
import { dirname, basename, uniqueName } from "@/lib/paths";
import { parseNote } from "@/lib/frontmatter";

// ---------------------------------------------------------------- versions

export async function listVersions(noteId: string): Promise<NoteVersion[]> {
  const rows = await ctx().sql.select<{ id: string; note_id: string; content: string; created_at: string }>(
    `SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at DESC`,
    [noteId],
  );
  return rows.map((r) => ({ id: r.id, noteId: r.note_id, content: r.content, createdAt: r.created_at }));
}

/** Restore an older version. The current content is snapshotted first so this is undoable. */
export async function restoreVersion(version: NoteVersion): Promise<string> {
  await snapshotNow(version.noteId);
  return saveNote(version.noteId, version.content);
}

// ---------------------------------------------------------------- trash

interface TrashRow {
  id: string;
  kind: TrashItem["kind"];
  title: string;
  original_path: string | null;
  trash_path: string | null;
  payload: string | null;
  deleted_at: string;
}

export async function listTrash(): Promise<TrashItem[]> {
  const rows = await ctx().sql.select<TrashRow>(`SELECT * FROM trash ORDER BY deleted_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    originalPath: r.original_path,
    trashPath: r.trash_path,
    deletedAt: r.deleted_at,
  }));
}

async function getRow(id: string) {
  const rows = await ctx().sql.select<TrashRow>(`SELECT * FROM trash WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function restoreTrashItem(id: string): Promise<void> {
  const row = await getRow(id);
  if (!row) return;
  const { vault, sql } = ctx();
  if (row.kind === "todo") {
    await restoreTodos(JSON.parse(row.payload ?? "[]"));
  } else if (row.trash_path && row.original_path) {
    if (await vault.exists(row.trash_path)) {
      const isNote = row.kind === "note";
      const name = isNote ? basename(row.original_path).replace(/\.md$/i, "") : basename(row.original_path);
      const target = await uniqueName(dirname(row.original_path), name, isNote ? ".md" : "", (p) => vault.exists(p));
      await vault.rename(row.trash_path, target);
      await vault.remove(dirname(row.trash_path)).catch(() => {});
    }
    await syncVault();
  }
  await sql.execute(`DELETE FROM trash WHERE id = ?`, [id]);
  emitChange("trash", "notes", "folders", "todos");
}

/** Permanently delete one trash entry (files, links, versions). */
export async function purgeTrashItem(id: string): Promise<void> {
  const row = await getRow(id);
  if (!row) return;
  const { vault, sql } = ctx();
  if (row.kind === "todo") {
    await purgeTodos(JSON.parse(row.payload ?? "[]"));
  } else if (row.trash_path) {
    const container = dirname(row.trash_path);
    // Collect note ids inside so their links and versions go too.
    const files = (await vault.list()).filter((e) => !e.isDir && e.path.startsWith(container + "/") && e.path.endsWith(".md"));
    for (const f of files) {
      const noteId = parseNote(await vault.readText(f.path).catch(() => "")).data.id;
      if (typeof noteId === "string") {
        await sql.execute(`DELETE FROM todo_note_links WHERE note_id = ?`, [noteId]);
        await sql.execute(`DELETE FROM note_versions WHERE note_id = ?`, [noteId]);
      }
    }
    await vault.remove(container).catch(() => {});
  }
  await sql.execute(`DELETE FROM trash WHERE id = ?`, [id]);
  emitChange("trash", "todos");
}

export async function emptyTrash(): Promise<void> {
  for (const item of await listTrash()) await purgeTrashItem(item.id);
}
