/**
 * @forgor/plugin-api: the types of Forgor's plugin API.
 *
 * Self-contained (only needs React's types), so plugin projects outside the
 * Forgor repo can use it. It's the public contract: the app checks during its
 * own type-check that what it gives plugins still matches this file
 * (src/plugins/publicApi.check.ts).
 *
 * A plugin's main.js exports a PluginFactory:
 *
 *   import type { PluginFactory } from "@forgor/plugin-api";
 *   const plugin: PluginFactory = (api) => ({ pages: { … }, start: () => … });
 *   export default plugin;
 */
import type * as React from "react";

// ---------------------------------------------------------------- data

export interface Folder {
  id: string;
  /** Path in the notes folder, e.g. "Clients/Acme" ("" is the top level). */
  path: string;
  /** Color id or "#rrggbb"; null = inherit from the parent folder. */
  color?: string | null;
  /** Uploaded icon (PNG data URL) shown instead of the folder symbol. */
  icon?: string | null;
}

export interface NoteMeta {
  id: string;
  /** Path in the notes folder, e.g. "Clients/Acme/Kickoff.md". */
  path: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TodoStatus = "todo" | "in_progress" | "waiting" | "blocked" | "done";
export type Priority = 1 | 2 | 3 | 4;

export interface Todo {
  id: string;
  title: string;
  description: string;
  status: TodoStatus;
  /** 1 = highest, 4 = none. */
  priority: Priority;
  /** YYYY-MM-DD. */
  dueDate: string | null;
  /** HH:mm. */
  dueTime: string | null;
  startDate: string | null;
  estimateMin: number | null;
  rrule: string | null;
  recurFromCompletion: boolean;
  parentId: string | null;
  folderId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  sourceNoteId: string | null;
  noteCount: number;
  subtaskCount: number;
}

export type TodoInput = Partial<
  Pick<Todo, "title" | "description" | "status" | "priority" | "dueDate" | "dueTime" | "startDate" | "estimateMin" | "rrule" | "recurFromCompletion" | "parentId" | "folderId">
>;

/** Notes and folders. Every change refreshes the app by itself. */
export interface NotesApi {
  listFolders(): Promise<Folder[]>;
  listNotes(): Promise<NoteMeta[]>;
  getNoteMeta(id: string): Promise<NoteMeta | null>;
  /** The note's markdown body and front matter. */
  readNote(id: string): Promise<{ meta: NoteMeta; data: Record<string, unknown>; body: string } | null>;
  /** `folderPath` "" is the top level. */
  createNote(folderPath: string, title?: string, body?: string): Promise<NoteMeta>;
  writeNoteBody(id: string, body: string): Promise<NoteMeta | null>;
  renameNote(id: string, newTitle: string): Promise<NoteMeta | null>;
  moveNote(id: string, folderPath: string): Promise<NoteMeta | null>;
  trashNote(id: string): Promise<void>;
  createFolder(parentPath: string, name?: string): Promise<Folder>;
  /** Rename or move: `newPath` is the full new path. */
  relocateFolder(id: string, newPath: string): Promise<Folder | null>;
  trashFolder(id: string): Promise<void>;
  setFolderColor(id: string, color: string | null): Promise<void>;
  /** Notes that link to this one. */
  backlinks(noteId: string): Promise<NoteMeta[]>;
}

export interface TodosApi {
  listTodos(): Promise<Todo[]>;
  getTodo(id: string): Promise<Todo | null>;
  listSubtasks(parentId: string): Promise<Todo[]>;
  createTodo(input: TodoInput): Promise<Todo>;
  updateTodo(id: string, patch: TodoInput & { sortOrder?: number }): Promise<Todo | null>;
  setDone(id: string, done: boolean): Promise<Todo | null>;
  deleteTodo(id: string): Promise<void>;
  linkNote(todoId: string, noteId: string): Promise<void>;
  unlinkNote(todoId: string, noteId: string): Promise<void>;
  notesForTodo(todoId: string): Promise<NoteMeta[]>;
  todosForNote(noteId: string): Promise<Todo[]>;
}

// ---------------------------------------------------------------- app

/** What the main area shows. A plugin's pages are `{ kind: "plugin", plugin: <its id>, page, param }`. */
export type View =
  | { kind: "inbox" | "today" | "all" | "search" | "archive" | "trash" | "settings" | "plugins" }
  | { kind: "note"; id: string }
  | { kind: "plugin"; plugin: string; page: string; param?: string };

/** Part of the app's UI state (read it with `api.app.useUI(s => …)`). */
export interface AppState {
  view: View | null;
  tabs: { id: string; view: View }[];
  selectedFolderId: string | null;
  selectedTodoId: string | null;
  settings: { theme: "system" | "light" | "dark"; accent: string; plugins: Record<string, boolean> };
  setView(view: View): void;
  openFolder(id: string | null): void;
  openTodo(id: string | null): void;
  closePanel(): void;
}

/** A store hook: `useUI(selector)` in components, `useUI.getState()` anywhere. */
export interface AppStore {
  <T>(selector: (state: AppState) => T): T;
  getState(): AppState;
  subscribe(listener: (state: AppState, previous: AppState) => void): () => void;
}

export interface AppEvents {
  /** A folder was opened (explorer, breadcrumb, link…): its id. */
  "folder-open": string;
}

/** What a data hook returns (TanStack Query). */
export interface QueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetched: boolean;
  error: unknown;
}

export type ModelId = "speech" | "speakers" | "language";

export interface WriteRequest {
  instruction: string;
  /** Selected markdown; empty = write at the cursor. */
  selection: string;
  /** The whole note. */
  document: string;
}

/** Streams the reply in pieces; aborting the signal stops it. */
export type WriteFn = (request: WriteRequest, signal: AbortSignal, onWarnings?: (warnings: string[]) => void) => AsyncIterable<string>;

// ---------------------------------------------------------------- components (the app's own)

type Icon = React.ComponentType<{ className?: string }>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "icon" | "icon-sm";
}

export interface UiApi {
  /** A sidebar entry; `target` is the view it opens. */
  NavItem: React.ComponentType<{ icon: Icon; label: string; target: View; count?: number; alert?: boolean; hint?: string; badge?: React.ReactNode; testId?: string }>;
  /** One setting in a plugin's panel: label and hint above the control. */
  Setting: React.ComponentType<{ label: string; hint?: string; children?: React.ReactNode }>;
  Button: React.ComponentType<ButtonProps>;
  Input: React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
  Textarea: React.ComponentType<React.TextareaHTMLAttributes<HTMLTextAreaElement>>;
  Switch: React.ComponentType<{ checked?: boolean; onCheckedChange?(checked: boolean): void; disabled?: boolean; id?: string; className?: string; "aria-label"?: string }>;
  Select<T extends string>(props: { value: T; onChange(value: T): void; options: { value: T; label: string }[]; className?: string; "aria-label"?: string }): React.ReactElement;
  /** A modal: `<Dialog open onOpenChange={…}><DialogContent title="…">…</DialogContent></Dialog>`. */
  Dialog: React.ComponentType<{ open?: boolean; onOpenChange?(open: boolean): void; children?: React.ReactNode }>;
  DialogContent: React.ComponentType<{ title: string; className?: string; children?: React.ReactNode }>;
  Tooltip: React.ComponentType<{ content: React.ReactNode; children: React.ReactNode }>;
  /** A page's title row (use at the top of a page). */
  PageHeader: React.ComponentType<{ title: string; subtitle?: string; icon?: React.ReactNode; children?: React.ReactNode }>;
  /** A titled list section (as in a folder's panel). */
  Section: React.ComponentType<{ title: string; count?: number; tone?: "danger"; collapsible?: boolean; heading?: React.ReactNode; children: React.ReactNode }>;
  /** A folder's symbol (its icon, or the folder glyph in its color). */
  FolderGlyph: React.ComponentType<{ icon?: string | null; color: string | null; open?: boolean; className?: string }>;
  /** A folder's name with its color. */
  FolderLabel: React.ComponentType<{ folderId: string | null; fallback?: string | null; full?: boolean; className?: string }>;
  /** A folder's color (own or inherited) as a CSS color, or null. */
  useFolderColor(folderId: string | null | undefined): string | null;
  /** Ask for confirmation (never use window.confirm: it doesn't work in the macOS app). */
  confirmDialog(options: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }): Promise<boolean>;
  /** An error toast. */
  showError(error: unknown, context?: string): void;
  /** Props for anything that opens a note (click; middle-click too). */
  noteLinkProps(noteId: string, after?: () => void): { onClick(): void; onMouseDown(e: React.MouseEvent): void; onAuxClick(e: React.MouseEvent): void };
  /** Join class names (falsy ones are skipped; later Tailwind classes win). */
  cn(...classes: (string | false | null | undefined)[]): string;
}

// ---------------------------------------------------------------- the API

export interface PluginApi {
  /** This plugin's id (from its manifest). */
  id: string;
  /** The app's React (the one `require("react")` gives). */
  React: typeof React;
  app: {
    useUI: AppStore;
    /** Show one of this plugin's pages (`pages[page]`). */
    openPage(page: string, param?: string): void;
    openNote(noteId: string): void;
    /** Opens the folder's panel on the right (null closes it). */
    openFolder(folderId: string | null): void;
    openTodo(todoId: string | null): void;
    /** The Plugins page with this plugin's panel (its settings). */
    openSettings(): void;
    /** Follow an app event; returns how to stop. */
    on<K extends keyof AppEvents>(event: K, cb: (payload: AppEvents[K]) => void): () => void;
    useEnabled(): boolean;
    queryClient: { invalidateQueries(filters?: { queryKey?: readonly unknown[] }): Promise<void> };
    useFolders(): QueryResult<Folder[]>;
    useNotes(): QueryResult<NoteMeta[]>;
    useTodos(): QueryResult<Todo[]>;
  };
  data: { notes: NotesApi; todos: TodosApi };
  /** This plugin's own small data, on this computer (not in the notes folder). JSON values. */
  storage: {
    get<T>(key: string, fallback: T): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
    /** As React state: [value, set]. */
    useValue<T>(key: string, fallback: T): [T, (value: T) => Promise<void>];
  };
  ui: UiApi;
  lib: {
    basename(path: string): string;
    dirname(path: string): string;
    joinPath(...parts: string[]): string;
    effectiveFolderColor(folderId: string | null | undefined, folders: Folder[]): string | null;
    colorHex(id: string | null | undefined): string | null;
  };
  platform: {
    /** True in the desktop app, false in the browser build. */
    isTauri(): boolean;
    /** Open a link in the default browser. */
    openExternal(url: string): Promise<void>;
  };
}

// ---------------------------------------------------------------- what a plugin returns

export interface PluginPage {
  /** The tab's label and icon (a hook: may use other hooks). */
  useTab(param: string | undefined): { label: string; icon: Icon };
  component: React.ComponentType<{ param: string | undefined }>;
}

export interface NoteHeaderProps {
  note: { id: string; path: string; folderId: string | null };
  editor: { hasSelection(): boolean; runAI(instruction: string): void };
}

export interface QuickMenuItem {
  icon: Icon;
  label: string;
  hint: string;
  action(): Promise<void> | void;
}

/** Everything is optional. The app shows a plugin's parts only while it is enabled. */
export interface PluginDefinition {
  /** Shown on its card (else the manifest's icon file, else a puzzle piece). */
  icon?: Icon;
  /** Its settings, in its panel on the Plugins page (use api.ui.Setting). */
  settings?: React.ComponentType;
  /** Items in the sidebar, below All tasks (use api.ui.NavItem). */
  sidebar?: React.ComponentType;
  /** Its pages by name; open them with api.app.openPage(name, param). */
  pages?: Record<string, PluginPage>;
  /** Right-hand panels by name. */
  panels?: Record<string, React.ComponentType<{ param: string; fromFolder: string | null }>>;
  /** A section in a folder's panel. */
  folderSection?: React.ComponentType<{ folder: Folder }>;
  /** In a note's top bar: before the folder path, and buttons on the right. */
  noteHeader?: { breadcrumb?: React.ComponentType<NoteHeaderProps>; actions?: React.ComponentType<NoteHeaderProps> };
  /** Gives the editor AI writing tools (a hook; null while not usable). */
  useWriter?: () => WriteFn | null;
  /** Always mounted while enabled (e.g. dialogs it opens from anywhere). */
  hosts?: React.ComponentType[];
  /** Runs in the main window while enabled; return how to stop (listeners, timers). */
  start?: () => () => void;
  /** Entries in the quick menu (global shortcut). A hook, called also while disabled (`enabled` false): return nothing then. */
  useQuickMenu?: (enabled: boolean) => { items: QuickMenuItem[]; status?: React.ReactNode; title?: string };
  /** Why it can't be disabled right now, or null. */
  disableBlocked?: () => string | null;
  /** First parts of query keys that are remote (not refreshed on every local change). */
  remoteQueries?: string[];
}

export type PluginFactory = (api: PluginApi) => PluginDefinition;

/** manifest.json */
export interface PluginManifest {
  /** Lowercase letters, digits and dashes; unique in the store. */
  id: string;
  name: string;
  /** x.y.z; raise it for every new version you publish. */
  version: string;
  author: string;
  description: string;
  /** The oldest Forgor version it works with. */
  minAppVersion?: string;
  /** Other plugins it needs (enabled along with it). */
  requires?: string[];
  /** AI models it uses. */
  models?: { id: ModelId; optional?: boolean; for: string }[];
}
