import { ctx, emitChange } from "./context";
import { getNoteMeta, writeNoteBody } from "./notes";
import { createTodo, getTodo, setDone, updateTodo } from "./todos";
import { assignTaskIds, parseTasks } from "@/lib/inlineTodos";
import { newId, nowIso } from "@/lib/utils";

/** Minimum time between automatic version snapshots of the same note. */
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_VERSIONS_PER_NOTE = 200;

/**
 * Save a note from the editor:
 *  1. `- [ ]` lines without a marker become new todos (marker appended),
 *  2. existing inline todos pick up checkbox/text changes,
 *  3. a version snapshot of the previous content is taken (throttled),
 *  4. the file is written.
 * Returns the final body. It differs from the input when markers were added.
 */
export async function saveNote(noteId: string, body: string): Promise<string> {
  const meta = await getNoteMeta(noteId);
  if (!meta) return body;

  const { md: finalBody, created } = assignTaskIds(body, () => newId());
  for (const c of created) {
    await createTodo({ id: c.id, title: c.text, status: c.checked ? "done" : "todo", sourceNoteId: noteId, folderId: meta.folderId });
  }
  const createdIds = new Set(created.map((c) => c.id));
  for (const task of parseTasks(finalBody)) {
    if (!task.todoId || createdIds.has(task.todoId)) continue;
    const todo = await getTodo(task.todoId);
    if (!todo) {
      // Marker for a todo we don't know (e.g. pasted from elsewhere): adopt it.
      await createTodo({ id: task.todoId, title: task.text, status: task.checked ? "done" : "todo", sourceNoteId: noteId, folderId: meta.folderId });
      continue;
    }
    if (todo.deletedAt) continue;
    if (todo.title !== task.text) await updateTodo(todo.id, { title: task.text }, { fromNote: true });
    if ((todo.status === "done") !== task.checked) await setDone(todo.id, task.checked, { fromNote: true });
  }

  await maybeSnapshot(noteId);
  await writeNoteBody(noteId, finalBody);
  return finalBody;
}

async function maybeSnapshot(noteId: string, force = false) {
  const { sql } = ctx();
  const [current] = await sql.select<{ content: string }>(`SELECT content FROM notes WHERE id = ?`, [noteId]);
  if (!current || !current.content.trim()) return;
  const [last] = await sql.select<{ content: string; created_at: string }>(
    `SELECT content, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1`,
    [noteId],
  );
  if (last && last.content === current.content) return;
  if (!force && last && Date.now() - new Date(last.created_at).getTime() < SNAPSHOT_INTERVAL_MS) return;
  await sql.execute(`INSERT INTO note_versions (id, note_id, content, created_at) VALUES (?, ?, ?, ?)`, [
    newId(),
    noteId,
    current.content,
    nowIso(),
  ]);
  await sql.execute(
    `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (
       SELECT id FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT ${MAX_VERSIONS_PER_NOTE})`,
    [noteId, noteId],
  );
  emitChange("versions");
}

/** Force a snapshot of the current content (e.g. before restoring an older version). */
export function snapshotNow(noteId: string) {
  return maybeSnapshot(noteId, true);
}
