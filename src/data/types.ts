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

export interface Folder {
  id: string;
  /** Vault-relative path, e.g. "Clients/Acme". */
  path: string;
  /** Color id (lib/folderColors.ts); null = inherit from parent folder. */
  color?: string | null;
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
  kind: "note" | "folder" | "todo" | "file";
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
  allTasksSort: "due" | "priority" | "folder" | "created" | "title";
  allTasksShowDone: boolean;
  /** Highlight color id, see lib/accents.ts. */
  accent: string;
  /** User-added colors ("#rrggbb"), offered in every color picker. */
  customColors: string[];
  /** Widths (px) of the left sidebar and the right-hand detail panel. */
  sidebarWidth: number;
  panelWidth: number;
  /** Window zoom factor (1 = 100%), Ctrl/⌘ +/-. */
  zoom: number;
}
