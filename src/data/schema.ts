import type { SqlDriver } from "@/platform/types";

/**
 * Ordered list of migrations. Each entry runs once; progress is tracked in
 * the `meta` table. Append new migrations; never edit old ones.
 *
 * Full-text search uses FTS4 (available in both the desktop SQLite and sql.js).
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE folders (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE)`,
    `CREATE TABLE notes (
      rid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      folder_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE VIRTUAL TABLE notes_fts USING fts4(title, content, tokenize=unicode61)`,
    `CREATE TABLE note_links (source_id TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY (source_id, target))`,
    `CREATE TABLE todos (
      rid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority INTEGER NOT NULL DEFAULT 4,
      due_date TEXT,
      due_time TEXT,
      start_date TEXT,
      estimate_min INTEGER,
      rrule TEXT,
      recur_from_completion INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      folder_id TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      source_note_id TEXT
    )`,
    `CREATE INDEX todos_parent ON todos(parent_id)`,
    `CREATE INDEX todos_folder ON todos(folder_id)`,
    `CREATE INDEX todos_due ON todos(due_date)`,
    `CREATE VIRTUAL TABLE todos_fts USING fts4(title, description, tokenize=unicode61)`,
    `CREATE TABLE checklist_items (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      sort_order REAL NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX checklist_todo ON checklist_items(todo_id)`,
    `CREATE TABLE todo_note_links (todo_id TEXT NOT NULL, note_id TEXT NOT NULL, PRIMARY KEY (todo_id, note_id))`,
    `CREATE INDEX links_note ON todo_note_links(note_id)`,
    `CREATE TABLE note_versions (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX versions_note ON note_versions(note_id, created_at)`,
    `CREATE TABLE trash (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      original_path TEXT,
      trash_path TEXT,
      payload TEXT,
      deleted_at TEXT NOT NULL
    )`,
  ],
  // v2: checklists merged into subtasks (existing items become subtasks of their todo)
  [
    `INSERT INTO todos (id, title, description, status, priority, parent_id, folder_id, sort_order, created_at, updated_at, completed_at)
     SELECT c.id, c.text, '', CASE WHEN c.done THEN 'done' ELSE 'todo' END, 4, c.todo_id, t.folder_id,
            (SELECT COALESCE(MAX(sort_order), 0) FROM todos) + c.sort_order, t.created_at, t.updated_at,
            CASE WHEN c.done THEN t.updated_at END
     FROM checklist_items c JOIN todos t ON t.id = c.todo_id`,
    `INSERT INTO todos_fts (docid, title, description)
     SELECT rid, title, description FROM todos WHERE id IN (SELECT id FROM checklist_items)`,
    `DROP TABLE checklist_items`,
  ],
];

export async function migrate(sql: SqlDriver): Promise<void> {
  await sql.execute(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const rows = await sql.select<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  const current = rows.length ? Number(rows[0].value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    for (const stmt of MIGRATIONS[v]) await sql.execute(stmt);
    await sql.execute(
      `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(v + 1)],
    );
  }
}
