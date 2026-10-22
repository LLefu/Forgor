import type { BitbucketRepoRef } from "@/lib/bitbucket";
import type { JiraBoardRef } from "@/lib/jira";
import type { BitbucketAccount } from "@/platform/bitbucket";
import type { JiraAccount } from "@/platform/jira";
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
  /** The Jira boards linked to this folder (a project can have several). */
  jiraBoards?: JiraBoardRef[];
  /** The Bitbucket repositories linked to this folder (the Bitbucket plugin). */
  bitbucketRepos?: BitbucketRepoRef[];
  /** Uploaded icon (PNG data URL) shown instead of the folder symbol; not inherited by subfolders. */
  icon?: string | null;
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

/** Sounds made in src-tauri/src/sound.rs, or none. */
export type NotificationSound = "chime" | "ping" | "pop" | "none";

export interface Settings {
  theme: "system" | "light" | "dark";
  /** The soft variant of the light/dark theme ("Light (soft)", "Dark (soft)"; the `soft` class on <html>). */
  themeSoft: boolean;
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
  /** Which plugins are enabled (plugin id → on). Filled from the flags below the first time (up to 0.5.1). */
  plugins: Record<string, boolean>;
  /** @deprecated Up to 0.5.1: the meetings plugin's on/off. Still written, so going back to 0.5.1 keeps the choice. */
  meetingsEnabled: boolean;
  /** Microphone device name; null = system default. */
  meetingMic: string | null;
  /** Language of the summary; speech in Dutch and English is recognized either way. */
  meetingLanguage: "auto" | "nl" | "en";
  /** @deprecated Up to 0.5.1: the writing plugin's on/off (see `plugins`). */
  writingEnabled: boolean;
  /** @deprecated Up to 0.5.1: the Jira plugin's on/off (see `plugins`). */
  jiraEnabled: boolean;
  /** The connected Jira account; the API token itself is in the OS keychain. */
  jiraAccount: JiraAccount | null;
  /** Desktop notifications at all (Settings → Notifications). */
  notificationsEnabled: boolean;
  /** Kinds of notifications switched off, as "plugin:kind" (a plugin's panel). */
  notificationsMuted: string[];
  /** The sound Forgor plays with a notification (src-tauri/src/sound.rs). */
  notificationSound: NotificationSound;
  /** The connected Bitbucket account; the API token itself is in the OS keychain. */
  bitbucketAccount: BitbucketAccount | null;
}
