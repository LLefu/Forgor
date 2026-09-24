import { ctx } from "./context";
import type { NoteMeta, Priority, Todo, TodoStatus } from "./types";
import { getTodo } from "./todos";

export interface SearchFilters {
  kind: "all" | "notes" | "todos";
  /** Folder path; includes subfolders. "" = everything. */
  folderPath: string;
  priority: Priority | null;
  status: TodoStatus | "open" | null;
  dueFrom: string | null;
  dueTo: string | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  kind: "all",
  folderPath: "",
  priority: null,
  status: null,
  dueFrom: null,
  dueTo: null,
};

export interface NoteHit {
  note: NoteMeta;
  /** Snippet with \u0001…\u0002 around matches (render-safe, no HTML). */
  snippet: string;
}

export interface TodoHit {
  todo: Todo;
  snippet: string;
}

export const HL_START = "\u0001";
export const HL_END = "\u0002";

/** Turn free text into a safe FTS4 query: every word must match (as a prefix). */
export function toFtsQuery(input: string): string | null {
  const words = input
    .split(/\s+/)
    .map((w) => w.replace(/["*^():]/g, "").trim())
    .filter((w) => w && !/^(AND|OR|NOT|NEAR)$/i.test(w));
  if (!words.length) return null;
  return words.map((w) => `"${w}*"`).join(" ");
}

export async function search(text: string, filters: SearchFilters = EMPTY_FILTERS): Promise<{ notes: NoteHit[]; todos: TodoHit[] }> {
  const q = toFtsQuery(text);
  const hasTodoFilter = !!(filters.priority || filters.status || filters.dueFrom || filters.dueTo);
  if (!q && !hasTodoFilter && !filters.folderPath) return { notes: [], todos: [] };

  const [notes, todos] = await Promise.all([
    filters.kind === "todos" || (hasTodoFilter && filters.kind === "all" && !q) ? [] : searchNotes(q, filters),
    filters.kind === "notes" ? [] : searchTodos(q, filters),
  ]);
  return { notes, todos };
}

async function folderIds(path: string): Promise<string[]> {
  const rows = await ctx().sql.select<{ id: string }>(`SELECT id FROM folders WHERE path = ? OR path LIKE ?`, [path, path + "/%"]);
  return rows.map((r) => r.id);
}

async function searchNotes(q: string | null, f: SearchFilters): Promise<NoteHit[]> {
  const { sql } = ctx();
  const where: string[] = [];
  const params: (string | number)[] = [];
  let from = `notes n`;
  let snippet = `substr(n.content, 1, 160)`;
  if (q) {
    from = `notes_fts JOIN notes n ON n.rid = notes_fts.docid`;
    where.push(`notes_fts MATCH ?`);
    params.push(q);
    snippet = `snippet(notes_fts, '${HL_START}', '${HL_END}', '…', -1, 14)`;
  }
  if (f.folderPath) {
    const ids = await folderIds(f.folderPath);
    if (!ids.length) return [];
    where.push(`n.folder_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  const rows = await sql.select<{ id: string; path: string; title: string; folder_id: string | null; created_at: string; updated_at: string; snip: string }>(
    `SELECT n.id, n.path, n.title, n.folder_id, n.created_at, n.updated_at, ${snippet} AS snip
     FROM ${from} ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY n.updated_at DESC LIMIT 100`,
    params,
  );
  return rows.map((r) => ({
    note: { id: r.id, path: r.path, title: r.title, folderId: r.folder_id, createdAt: r.created_at, updatedAt: r.updated_at },
    snippet: r.snip ?? "",
  }));
}

async function searchTodos(q: string | null, f: SearchFilters): Promise<TodoHit[]> {
  const { sql } = ctx();
  const where: string[] = [`t.deleted_at IS NULL`];
  const params: (string | number)[] = [];
  let from = `todos t`;
  let snippet = `''`;
  if (q) {
    from = `todos_fts JOIN todos t ON t.rid = todos_fts.docid`;
    where.push(`todos_fts MATCH ?`);
    params.push(q);
    snippet = `snippet(todos_fts, '${HL_START}', '${HL_END}', '…', -1, 14)`;
  }
  if (f.folderPath) {
    const ids = await folderIds(f.folderPath);
    if (!ids.length) return [];
    where.push(`t.folder_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (f.priority) {
    where.push(`t.priority = ?`);
    params.push(f.priority);
  }
  if (f.status === "open") where.push(`t.status != 'done'`);
  else if (f.status) {
    where.push(`t.status = ?`);
    params.push(f.status);
  }
  if (f.dueFrom) {
    where.push(`t.due_date >= ?`);
    params.push(f.dueFrom);
  }
  if (f.dueTo) {
    where.push(`t.due_date <= ?`);
    params.push(f.dueTo);
  }
  const rows = await sql.select<{ id: string; snip: string }>(
    `SELECT t.id, ${snippet} AS snip FROM ${from} WHERE ${where.join(" AND ")}
     ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.priority LIMIT 100`,
    params,
  );
  const out: TodoHit[] = [];
  for (const r of rows) {
    const todo = await getTodo(r.id);
    if (todo) out.push({ todo, snippet: r.snip ?? "" });
  }
  return out;
}
