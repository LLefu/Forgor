import { ctx, emitChange } from "./context";
import type { ChecklistItem, NoteMeta, Priority, Todo, TodoStatus } from "./types";
import { newId, nowIso } from "@/lib/utils";
import { addDaysStr, shouldArchive, todayStr } from "@/lib/dates";
import { nextOccurrence } from "@/lib/recurrence";
import { setTaskChecked, setTaskText } from "@/lib/inlineTodos";
import { readNote, writeNoteBody } from "./notes";
import { differenceInCalendarDays, parseISO } from "date-fns";

interface TodoRow {
  rid: number;
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  priority: number;
  due_date: string | null;
  due_time: string | null;
  start_date: string | null;
  estimate_min: number | null;
  rrule: string | null;
  recur_from_completion: number;
  parent_id: string | null;
  folder_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  source_note_id: string | null;
  note_count: number;
  subtask_count: number;
  subtask_done: number;
}

const SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM todo_note_links l JOIN notes n ON n.id = l.note_id WHERE l.todo_id = t.id) AS note_count,
    (SELECT COUNT(*) FROM todos s WHERE s.parent_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
    (SELECT COUNT(*) FROM todos s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.status = 'done') AS subtask_done
  FROM todos t`;

function toTodo(r: TodoRow): Todo {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority as Priority,
    dueDate: r.due_date,
    dueTime: r.due_time,
    startDate: r.start_date,
    estimateMin: r.estimate_min,
    rrule: r.rrule,
    recurFromCompletion: !!r.recur_from_completion,
    parentId: r.parent_id,
    folderId: r.folder_id,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    archivedAt: r.archived_at,
    deletedAt: r.deleted_at,
    sourceNoteId: r.source_note_id,
    noteCount: Number(r.note_count ?? 0),
    subtaskCount: Number(r.subtask_count ?? 0),
    subtaskDone: Number(r.subtask_done ?? 0),
  };
}

// ---------------------------------------------------------------- queries

/** All non-deleted, non-archived todos (including done ones not yet archived). */
export async function listTodos(): Promise<Todo[]> {
  const rows = await ctx().sql.select<TodoRow>(`${SELECT} WHERE t.deleted_at IS NULL AND t.archived_at IS NULL ORDER BY t.sort_order`);
  return rows.map(toTodo);
}

export async function listArchived(): Promise<Todo[]> {
  const rows = await ctx().sql.select<TodoRow>(
    `${SELECT} WHERE t.deleted_at IS NULL AND t.archived_at IS NOT NULL ORDER BY t.completed_at DESC LIMIT 500`,
  );
  return rows.map(toTodo);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const rows = await ctx().sql.select<TodoRow>(`${SELECT} WHERE t.id = ?`, [id]);
  return rows[0] ? toTodo(rows[0]) : null;
}

export async function listSubtasks(parentId: string): Promise<Todo[]> {
  const rows = await ctx().sql.select<TodoRow>(`${SELECT} WHERE t.parent_id = ? AND t.deleted_at IS NULL ORDER BY t.sort_order`, [
    parentId,
  ]);
  return rows.map(toTodo);
}

// ---------------------------------------------------------------- create / update

export type TodoInput = Partial<
  Pick<
    Todo,
    | "title"
    | "description"
    | "status"
    | "priority"
    | "dueDate"
    | "dueTime"
    | "startDate"
    | "estimateMin"
    | "rrule"
    | "recurFromCompletion"
    | "parentId"
    | "folderId"
    | "sourceNoteId"
  >
> & { id?: string };

async function nextSortOrder(): Promise<number> {
  const [{ m }] = await ctx().sql.select<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM todos`);
  return (m ?? 0) + 1;
}

export async function createTodo(input: TodoInput): Promise<Todo> {
  const { sql } = ctx();
  const id = input.id ?? newId();
  const now = nowIso();
  const status = input.status ?? "todo";
  await sql.execute(
    `INSERT INTO todos (id, title, description, status, priority, due_date, due_time, start_date, estimate_min, rrule,
       recur_from_completion, parent_id, folder_id, sort_order, created_at, updated_at, completed_at, source_note_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      (input.title ?? "").trim() || "Untitled",
      input.description ?? "",
      status,
      input.priority ?? 4,
      input.dueDate ?? null,
      input.dueDate ? (input.dueTime ?? null) : null,
      input.startDate ?? null,
      input.estimateMin ?? null,
      input.rrule ?? null,
      input.recurFromCompletion ? 1 : 0,
      input.parentId ?? null,
      input.folderId ?? null,
      await nextSortOrder(),
      now,
      now,
      status === "done" ? now : null,
      input.sourceNoteId ?? null,
    ],
  );
  await reindex(id);
  if (input.sourceNoteId) await linkNote(id, input.sourceNoteId, { silent: true });
  emitChange("todos");
  return (await getTodo(id))!;
}

const COLUMN: Record<string, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  dueDate: "due_date",
  dueTime: "due_time",
  startDate: "start_date",
  estimateMin: "estimate_min",
  rrule: "rrule",
  recurFromCompletion: "recur_from_completion",
  parentId: "parent_id",
  folderId: "folder_id",
  sortOrder: "sort_order",
  sourceNoteId: "source_note_id",
};

export type TodoPatch = Partial<Omit<TodoInput, "id">> & { sortOrder?: number };

/**
 * Update fields. Changing status to/from "done" goes through completion logic
 * (recurrence, completed_at, inline note sync).
 */
export async function updateTodo(id: string, patch: TodoPatch, opts: { fromNote?: boolean } = {}): Promise<Todo | null> {
  const before = await getTodo(id);
  if (!before) return null;
  const { status, ...rest } = patch;
  if (rest.dueDate === null) rest.dueTime = null;

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(rest)) {
    const col = COLUMN[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    params.push(typeof v === "boolean" ? (v ? 1 : 0) : ((v ?? null) as string | number | null));
  }
  if (status && status !== before.status) {
    sets.push(`status = ?`);
    params.push(status);
  }
  if (sets.length) {
    sets.push(`updated_at = ?`);
    params.push(nowIso(), id);
    await ctx().sql.execute(`UPDATE todos SET ${sets.join(", ")} WHERE id = ?`, params);
    await reindex(id);
  }

  if (status && status !== before.status && (status === "done" || before.status === "done")) {
    await onCompletionChange(id, status === "done", opts);
  }
  if (rest.title !== undefined && rest.title !== before.title && before.sourceNoteId && !opts.fromNote) {
    await pushToNote(before.sourceNoteId, (md) => setTaskText(md, id, rest.title!));
  }
  emitChange("todos");
  return getTodo(id);
}

export function setDone(id: string, done: boolean, opts: { fromNote?: boolean } = {}) {
  return updateTodo(id, { status: done ? "done" : "todo" }, opts);
}

async function onCompletionChange(id: string, done: boolean, opts: { fromNote?: boolean }) {
  const { sql } = ctx();
  await sql.execute(`UPDATE todos SET completed_at = ? WHERE id = ?`, [done ? nowIso() : null, id]);
  const todo = (await getTodo(id))!;
  if (todo.sourceNoteId && !opts.fromNote) {
    await pushToNote(todo.sourceNoteId, (md) => setTaskChecked(md, id, done));
  }
  if (done && todo.rrule) await spawnNextOccurrence(todo);
}

/** When a recurring todo is completed, create the next instance. */
async function spawnNextOccurrence(t: Todo) {
  const today = todayStr();
  const anchor = t.recurFromCompletion ? today : (t.dueDate ?? today);
  let next = nextOccurrence(t.rrule!, anchor);
  // Skip past occurrences so an overdue daily todo doesn't respawn as overdue.
  while (next && !t.recurFromCompletion && next < today) next = nextOccurrence(t.rrule!, next);
  if (!next) return;
  let startDate: string | null = null;
  if (t.startDate && t.dueDate) {
    startDate = addDaysStr(next, differenceInCalendarDays(parseISO(t.startDate), parseISO(t.dueDate)));
  }
  const clone = await createTodo({
    title: t.title,
    description: t.description,
    priority: t.priority,
    dueDate: next,
    dueTime: t.dueTime,
    startDate,
    estimateMin: t.estimateMin,
    rrule: t.rrule,
    recurFromCompletion: t.recurFromCompletion,
    folderId: t.folderId,
    parentId: t.parentId,
  });
  // The completed instance no longer repeats; the clone carries the rule.
  await ctx().sql.execute(`UPDATE todos SET rrule = NULL WHERE id = ?`, [t.id]);
  for (const item of await listChecklist(t.id)) await addChecklistItem(clone.id, item.text);
  for (const n of await notesForTodo(t.id)) await linkNote(clone.id, n.id, { silent: true });
}

/** Apply a markdown transform to the source note of an inline todo. */
async function pushToNote(noteId: string, transform: (md: string) => string | null) {
  const note = await readNote(noteId).catch(() => null);
  if (!note) return;
  const updated = transform(note.body);
  if (updated !== null) await writeNoteBody(noteId, updated);
}

async function reindex(id: string) {
  const { sql } = ctx();
  const rows = await sql.select<{ rid: number; title: string; description: string; deleted_at: string | null }>(
    `SELECT rid, title, description, deleted_at FROM todos WHERE id = ?`,
    [id],
  );
  if (!rows[0]) return;
  await sql.execute(`DELETE FROM todos_fts WHERE docid = ?`, [rows[0].rid]);
  if (!rows[0].deleted_at) {
    await sql.execute(`INSERT INTO todos_fts (docid, title, description) VALUES (?, ?, ?)`, [
      rows[0].rid,
      rows[0].title,
      rows[0].description,
    ]);
  }
}

// ---------------------------------------------------------------- delete / restore / archive

export async function deleteTodo(id: string): Promise<void> {
  const { sql } = ctx();
  const t = await getTodo(id);
  if (!t) return;
  const now = nowIso();
  const ids = [id, ...(await listSubtasks(id)).map((s) => s.id)];
  for (const tid of ids) {
    await sql.execute(`UPDATE todos SET deleted_at = ? WHERE id = ?`, [now, tid]);
    await reindex(tid);
  }
  await sql.execute(`INSERT INTO trash (id, kind, title, payload, deleted_at) VALUES (?, 'todo', ?, ?, ?)`, [
    newId(),
    t.title,
    JSON.stringify(ids),
    now,
  ]);
  emitChange("todos", "trash");
}

export async function restoreTodos(ids: string[]): Promise<void> {
  for (const id of ids) {
    await ctx().sql.execute(`UPDATE todos SET deleted_at = NULL WHERE id = ?`, [id]);
    await reindex(id);
  }
  emitChange("todos");
}

export async function purgeTodos(ids: string[]): Promise<void> {
  const { sql } = ctx();
  for (const id of ids) {
    const rows = await sql.select<{ rid: number }>(`SELECT rid FROM todos WHERE id = ?`, [id]);
    if (rows[0]) await sql.execute(`DELETE FROM todos_fts WHERE docid = ?`, [rows[0].rid]);
    await sql.execute(`DELETE FROM todos WHERE id = ?`, [id]);
    await sql.execute(`DELETE FROM checklist_items WHERE todo_id = ?`, [id]);
    await sql.execute(`DELETE FROM todo_note_links WHERE todo_id = ?`, [id]);
  }
}

/** Archive todos completed more than `days` ago. Returns how many were archived. */
export async function archiveCompleted(days: number, now = new Date()): Promise<number> {
  const { sql } = ctx();
  const rows = await sql.select<TodoRow>(`${SELECT} WHERE t.status = 'done' AND t.archived_at IS NULL AND t.deleted_at IS NULL`);
  let n = 0;
  for (const t of rows.map(toTodo)) {
    if (shouldArchive(t, now, days)) {
      await sql.execute(`UPDATE todos SET archived_at = ? WHERE id = ?`, [now.toISOString(), t.id]);
      n++;
    }
  }
  if (n) emitChange("todos");
  return n;
}

export async function unarchive(id: string): Promise<void> {
  await ctx().sql.execute(`UPDATE todos SET archived_at = NULL WHERE id = ?`, [id]);
  emitChange("todos");
}

// ---------------------------------------------------------------- checklist

export async function listChecklist(todoId: string): Promise<ChecklistItem[]> {
  const rows = await ctx().sql.select<{ id: string; todo_id: string; text: string; done: number; sort_order: number }>(
    `SELECT * FROM checklist_items WHERE todo_id = ? ORDER BY sort_order`,
    [todoId],
  );
  return rows.map((r) => ({ id: r.id, todoId: r.todo_id, text: r.text, done: !!r.done, sortOrder: r.sort_order }));
}

export async function addChecklistItem(todoId: string, text: string): Promise<void> {
  const { sql } = ctx();
  const [{ m }] = await sql.select<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM checklist_items WHERE todo_id = ?`, [todoId]);
  await sql.execute(`INSERT INTO checklist_items (id, todo_id, text, done, sort_order) VALUES (?, ?, ?, 0, ?)`, [
    newId(),
    todoId,
    text,
    (m ?? 0) + 1,
  ]);
  emitChange("todos");
}

export async function updateChecklistItem(id: string, patch: { text?: string; done?: boolean }): Promise<void> {
  const { sql } = ctx();
  if (patch.text !== undefined) await sql.execute(`UPDATE checklist_items SET text = ? WHERE id = ?`, [patch.text, id]);
  if (patch.done !== undefined) await sql.execute(`UPDATE checklist_items SET done = ? WHERE id = ?`, [patch.done ? 1 : 0, id]);
  emitChange("todos");
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await ctx().sql.execute(`DELETE FROM checklist_items WHERE id = ?`, [id]);
  emitChange("todos");
}

// ---------------------------------------------------------------- note links (many-to-many)

export async function linkNote(todoId: string, noteId: string, opts: { silent?: boolean } = {}): Promise<void> {
  await ctx().sql.execute(`INSERT OR IGNORE INTO todo_note_links (todo_id, note_id) VALUES (?, ?)`, [todoId, noteId]);
  if (!opts.silent) emitChange("todos", "notes");
}

export async function unlinkNote(todoId: string, noteId: string): Promise<void> {
  await ctx().sql.execute(`DELETE FROM todo_note_links WHERE todo_id = ? AND note_id = ?`, [todoId, noteId]);
  emitChange("todos", "notes");
}

export async function notesForTodo(todoId: string): Promise<NoteMeta[]> {
  const rows = await ctx().sql.select<{ id: string; path: string; title: string; folder_id: string | null; created_at: string; updated_at: string }>(
    `SELECT n.id, n.path, n.title, n.folder_id, n.created_at, n.updated_at FROM todo_note_links l
     JOIN notes n ON n.id = l.note_id WHERE l.todo_id = ? ORDER BY n.title COLLATE NOCASE`,
    [todoId],
  );
  return rows.map((r) => ({ id: r.id, path: r.path, title: r.title, folderId: r.folder_id, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export async function todosForNote(noteId: string): Promise<Todo[]> {
  const rows = await ctx().sql.select<TodoRow>(
    `${SELECT} JOIN todo_note_links l ON l.todo_id = t.id WHERE l.note_id = ? AND t.deleted_at IS NULL ORDER BY t.status = 'done', t.sort_order`,
    [noteId],
  );
  return rows.map(toTodo);
}
