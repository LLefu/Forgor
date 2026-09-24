export type TodoStatus = "todo" | "in_progress" | "waiting" | "blocked" | "done";
export type Priority = 1 | 2 | 3 | 4;

export const STATUS_LABELS: Record<TodoStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  blocked: "Blocked",
  done: "Done",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: "P1 · Urgent",
  2: "P2 · High",
  3: "P3 · Medium",
  4: "P4 · None",
};

export interface Todo {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  priority: Priority;
  /** Local calendar date, YYYY-MM-DD. */
  dueDate: string | null;
  /** Local time, HH:mm. Only meaningful with dueDate. */
  dueTime: string | null;
  /** "Do on / start" date, YYYY-MM-DD. The todo shows up in Today from this date. */
  startDate: string | null;
  estimateMin: number | null;
  rrule: string | null;
  /** Repeat relative to completion date instead of the due date. */
  recurFromCompletion: boolean;
  parentId: string | null;
  folderId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  /** Set when the todo was created from a `- [ ]` line inside a note. */
  sourceNoteId: string | null;
  /** Computed: number of linked notes. */
  noteCount: number;
  /** Computed: subtasks total / done. */
  subtaskCount: number;
  subtaskDone: number;
}

export interface ChecklistItem {
  id: string;
  todoId: string;
  text: string;
  done: boolean;
  sortOrder: number;
}

export interface Folder {
  id: string;
  /** Vault-relative path, e.g. "Clients/Acme". */
  path: string;
}

export interface NoteMeta {
  id: string;
  path: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  content: string;
  createdAt: string;
}

export interface TrashItem {
  id: string;
  kind: "note" | "folder" | "todo";
  title: string;
  originalPath: string | null;
  trashPath: string | null;
  deletedAt: string;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  archiveAfterDays: number;
  hotkey: string;
  vaultPath: string | null;
  upcomingDays: number;
  /** Highlight color id, see lib/accents.ts. */
  accent: string;
}
