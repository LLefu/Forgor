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
  /** Its own CSS (styles.css), applied while it is enabled. */
  styles?: string;
  /** Other plugins that must be enabled for this one to work (by id). */
  requires?: string[];
  /** AI models it uses (Settings → AI models). Optional ones add something but aren't needed. */
  models?: { id: ModelId; optional?: boolean; for: string }[];

  // ---------------------------------------------------------------- contributions

  /** Its settings, shown in its panel on the Plugins page (stacked; use `Setting` from plugins/ui). */
  settings?: ComponentType;
  /** Items in the sidebar, below All tasks (use `NavItem`). */
  sidebar?: ComponentType;
  /** Its pages, by name; opened with `{ kind: "plugin", plugin: id, page, param }`. */
  pages?: Record<string, PluginPage>;
  /** Its right-hand panels, by name; opened with `openPluginPanel({ plugin: id, panel, param })`. */
  panels?: Record<string, ComponentType<{ param: string; fromFolder: string | null }>>;
  /** A section in a folder's panel. */
  folderSection?: ComponentType<{ folder: Folder }>;
  /** In a note's top bar: before the folder path, and buttons on the right. */
  noteHeader?: { breadcrumb?: ComponentType<NoteHeaderProps>; actions?: ComponentType<NoteHeaderProps> };
  /** Gives the editor its AI writing tools (selection toolbar, "Ask AI"). null while not usable (e.g. no model). */
  useWriter?: () => WriteFn | null;
  /** Always mounted while enabled (dialogs it opens from anywhere). */
  hosts?: ComponentType[];
  /** Runs in the main window while enabled; returns how to stop. */
  start?: () => () => void;
  /**
   * Quick menu (popup window) entries and a status line. Called as a hook in
   * every popup render, also while the plugin is disabled (`enabled` false):
   * return nothing then.
   */
  useQuickMenu?: (enabled: boolean) => { items: QuickMenuItem[]; status?: ReactNode; title?: string };
  /** Why it can't be disabled right now (e.g. "Stop the recording first"), or null. */
  disableBlocked?: () => string | null;
  /** First parts of query keys that are remote: not refreshed on every local change, they refresh on their own. */
  remoteQueries?: string[];
  /** The kinds of desktop notifications it sends (app/notifications.ts); its panel shows a switch for each. */
  notifications?: PluginNotificationKind[];
}

export interface PluginNotificationKind {
  /** Used with notifyNew / notify (e.g. "review"). */
  kind: string;
  /** "New review requests" */
  label: string;
  /** When it notifies, in one sentence. */
  hint?: string;
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
