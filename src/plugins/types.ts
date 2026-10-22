import type { ComponentType, ReactNode } from "react";
import type { Folder } from "@/data/types";
import type { ModelId } from "@/platform/models";
import type { WriteFn } from "@/platform/writing";

/**
 * A plugin: what it is (the manifest fields) and what it adds to the app
 * (the contribution points). The app only shows a contribution while its
 * plugin is enabled. Turning a plugin off never deletes its data.
 *
 * The built-in plugins live in src/plugins/<id>/ and are always installed;
 * the same shape is meant for community plugins later.
 */
export interface Plugin {
  id: string;
  name: string;
  /** One or two sentences: what it does. */
  description: string;
  version: string;
  author: string;
  icon: ComponentType<{ className?: string }>;
  /** Shipped with the app (can be disabled, not removed). */
  builtIn?: boolean;
  /** Set on community plugins (installed in app data). */
  source?: "installed";
  /** Why it couldn't be loaded (it then contributes nothing). */
  error?: string;
  /** Parts of its definition that were ignored because they had the wrong shape (plugins/validate.ts). */
  warnings?: string[];
  /** The Forgor version it was made for (its manifest's `minAppVersion`). */
  minAppVersion?: string;
  /** Switched off after an error and not loaded: only its manifest is known until the user switches it on again. */
  deferred?: boolean;
  /** Its own CSS (styles.css), applied while it is enabled. */
  styles?: string;
  /** Other plugins that must be enabled for this one to work (by id). */
  requires?: string[];
  /** AI models it uses (Settings → AI models). Optional ones add something but aren't needed. */
  models?: { id: ModelId; optional?: boolean; for: string }[];

  // ---------------------------------------------------------------- contributions

  /** Its settings, shown in its panel on the Plugins page (stacked; use `Setting` from plugins/ui). */
  settings?: ComponentType;
  /** Items in the sidebar, below Todos (use `NavItem`). */
  sidebar?: ComponentType;
  /** Its pages, by name; opened with `{ kind: "plugin", plugin: id, page, param }`. */
  pages?: Record<string, PluginPage>;
  /** Its right-hand panels, by name; opened with `openPluginPanel({ plugin: id, panel, param })`. */
  panels?: Record<string, ComponentType<{ param: string; fromFolder: string | null }>>;
  /** A section in a folder's panel. */
  folderSection?: ComponentType<{ folder: Folder }>;
  /** On the Today page: numbers in the row on top (`cards`, use `TodayCard`) and short lists of what needs attention (`section`, use `TodayList`). Show nothing while not set up. */
  today?: { cards?: ComponentType; section?: ComponentType };
  /** In a note's top bar: before the folder path, and buttons on the right. */
  noteHeader?: { breadcrumb?: ComponentType<NoteHeaderProps>; actions?: ComponentType<NoteHeaderProps> };
  /** Gives the editor its AI writing tools (selection toolbar, "Ask AI"). null while not usable (e.g. no model). */
  useWriter?: () => WriteFn | null;
  /** Always mounted while enabled (dialogs it opens from anywhere). */
  hosts?: ComponentType[];
  /** Runs in the main window while enabled; returns how to stop. */
  start?: () => () => void;
  /**
   * Quick menu (popup window) entries and a status line. A hook, called in a
   * component of its own while the plugin is enabled (`enabled` is always true).
   */
  useQuickMenu?: (enabled: boolean) => { items: QuickMenuItem[]; status?: ReactNode; title?: string };
  /** Why it can't be disabled right now (e.g. "Stop the recording first"), or null. */
  disableBlocked?: () => string | null;
  /** First parts of query keys that are remote: not refreshed on every local change, they refresh on their own. */
  remoteQueries?: string[];
  /** The kinds of desktop notifications it sends (app/notifications.ts); its panel shows a switch for each. */
  notifications?: PluginNotificationKind[];
  /** Keyboard shortcuts (main window, while enabled); listed in Settings → Shortcuts under its name, where the user can change them. */
  shortcuts?: PluginShortcut[];
  /** Things the AI chat may search and the user may attach to a question ("@"): tickets, pull requests… */
  chat?: PluginChatSource;
}

export interface PluginChatSource {
  /** What one item is, for the model and the "@" list: "Jira ticket". */
  kind: string;
  /** Everything it may use now (from cached queries: called for every question). Empty while not set up. */
  items: () => Promise<PluginChatItem[]>;
}

export interface PluginChatItem {
  /** Unique within the plugin ("NZP-41"). */
  id: string;
  /** "NZP-41 Dashboard load time" */
  title: string;
  /** What the model reads: status, description, dates… (plain text, keep it short). */
  text: string;
  /** The folder it belongs to (a linked board or repo), so "for project X" finds it. */
  folderId?: string | null;
  /** Shows it (a panel, a page). */
  open: () => void;
  /** More text when the user attaches it ("@"): the description, latest comments… (may fetch). */
  detail?: () => Promise<string>;
}

export interface PluginShortcut {
  /** Unique within the plugin ("start-recording"). */
  id: string;
  /** "Start or stop recording" */
  label: string;
  /** Default combos, e.g. ["Mod+Shift+R"] (Mod = ⌘ on macOS, Ctrl elsewhere). Leave empty to let the user pick. A combo the app already uses is skipped. */
  keys?: string[];
  run: () => void | Promise<void>;
}

export interface PluginNotificationKind {
  /** Used with notifyNew / notify (e.g. "review"). */
  kind: string;
  /** "New review requests" */
  label: string;
  /** When it notifies, in one sentence. */
  hint?: string;
  /** Its own options (e.g. which comments), shown under its switch while it's on. */
  settings?: ComponentType;
}

export interface PluginPage {
  /** The tab's label and icon (may depend on `param`). */
  useTab: (param: string | undefined) => { label: string; icon: ComponentType<{ className?: string }> };
  component: ComponentType<{ param: string | undefined }>;
}

export interface NoteHeaderProps {
  note: { id: string; path: string; folderId: string | null };
  /** The note's editor (for writing tools). */
  editor: { hasSelection: () => boolean; runAI: (instruction: string) => void };
}

export interface QuickMenuItem {
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  action: () => Promise<void> | void;
}
