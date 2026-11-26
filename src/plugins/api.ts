import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useUI } from "@/app/store";
import { onAppEvent, type AppEvents } from "@/app/events";
import { queryClient, useFolders, useNotes, useTodos } from "@/app/queries";
import { noteLinkProps } from "@/app/noteLink";
import * as notes from "@/data/notes";
import * as todos from "@/data/todos";
import { getPluginValue, setPluginValue } from "@/data/pluginStorage";
import { notify, notifyNew, pollForNotifications, type NotificationTarget, type NotifyItem } from "@/app/notifications";
import { NavItem } from "@/components/NavItem";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { FolderGlyph, FolderLabel, useFolderColor } from "@/features/folder/folderColors";
import { PageHeader, Section } from "@/features/todos/TodosPage";
import { TodayCard, TodayList } from "@/features/today/TodayCard";
import { effectiveFolderColor, colorHex } from "@/lib/folderColors";
import { iconFromPlugin } from "@/lib/folderIcon";
import { listItems, useItems } from "./items";
import { basename, dirname, joinPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { isTauri } from "@/platform/env";
import { openExternal } from "@/platform/os";
import { oauth, type OAuthProvider } from "@/platform/oauth";
import { Setting } from "./ui";
import { EmbeddedNote } from "@/features/editor/EmbeddedNote";
import { openPluginSettings, pluginView, usePluginEnabled } from "./host";
import type { Plugin } from "./types";

/**
 * What a plugin gets: `export default (api) => ({ ...contributions })` in its
 * main.js. Plugins can do anything the app can; this is what the app offers
 * so they don't have to reach into it (and look like the rest of the app).
 * The same React as the app's comes from `require("react")` (keep react,
 * react/jsx-runtime and react-dom external when bundling).
 */
export function createPluginApi(id: string) {
  const storageKey = (key: string) => ["plugin-storage", id, key];
  const storage = {
    get: <T>(key: string, fallback: T) => getPluginValue<T>(id, key, fallback),
    set: async (key: string, value: unknown) => {
      await setPluginValue(id, key, value);
      queryClient.setQueryData(storageKey(key), value);
    },
    /** A stored value as React state: [value, set]. */
    useValue: <T>(key: string, fallback: T): [T, (value: T) => Promise<void>] => {
      const { data } = useQuery({ queryKey: storageKey(key), queryFn: () => getPluginValue<T>(id, key, fallback) });
      return [(data as T | undefined) ?? fallback, (value: T) => storage.set(key, value)];
    },
  };

  return {
    /** This plugin's id (from its manifest). */
    id,
    React,
    app: {
      /** The app's UI store (tabs, panels, settings). */
      useUI,
      /** Show a page of this plugin (`pages[page]`), in the page tab. */
      openPage: (page: string, param?: string) => useUI.getState().setView(pluginView(id, page, param)),
      openNote: (noteId: string) => useUI.getState().setView({ kind: "note", id: noteId }),
      /** The folder's page (a plugin's `folderView`) or its panel; `{ panel: true }` always opens the panel. */
      openFolder: (folderId: string | null, opts?: { panel?: boolean }) => useUI.getState().openFolder(folderId, opts),
      openTodo: (todoId: string | null) => useUI.getState().openTodo(todoId),
      openSettings: () => openPluginSettings(id),
      /** Follow app events (e.g. "folder-open"); returns how to stop. */
      on: <K extends keyof AppEvents>(event: K, cb: (payload: AppEvents[K]) => void) => onAppEvent(event, cb),
      useEnabled: () => usePluginEnabled(id),
      queryClient,
      /** The app's useQuery (its client), with the options plugins need. */
      useQuery: <T,>(options: PluginQueryOptions<T>) => useQuery(options),
      useFolders,
      useNotes,
      useTodos,
      /** Every enabled plugin's `items` (tickets, pull requests…) as one list, kept fresh; `errors` names sources that failed. */
      useItems,
      /** The same once, outside React. */
      listItems: () => listItems(),
    },
    /** The app's data layer: notes and folders (create, rename, move…), todos. Changes refresh the app by themselves. */
    data: {
      notes: {
        ...notes,
        /** Any image (Blob or data URL), scaled to the app's folder-icon size; null removes it. */
        setFolderIcon: async (folderId: string, icon: Blob | string | null) =>
          notes.setFolderIcon(folderId, icon === null ? null : await iconFromPlugin(icon)),
      },
      todos,
    },
    /** Small data of this plugin (on this computer, not in the notes folder). */
    storage,
    /**
     * Signing in to a web service (OAuth 2 with PKCE in the system browser; platform/oauth.ts). The refresh token
     * stays in the keychain, in Rust: plugins only get short-lived access tokens.
     */
    auth: {
      /** An access token: cached or refreshed, else (unless `interactive: false`) after signing in in the browser. null: not signed in. */
      getToken: (provider: OAuthProvider, opts?: { interactive?: boolean }) => oauth().token(id, provider, opts?.interactive ?? true),
      /** `fetch` with the access token; when not signed in it signs in first (or fails with `interactive: false`). */
      fetch: async (provider: OAuthProvider, input: string, init: RequestInit & { interactive?: boolean } = {}) => {
        const { interactive = true, ...rest } = init;
        const token = await oauth().token(id, provider, interactive);
        if (!token) throw new Error("Not signed in");
        const headers = new Headers(rest.headers);
        headers.set("Authorization", `Bearer ${token.accessToken}`);
        return fetch(input, { ...rest, headers });
      },
      /** Stop waiting for the browser (a "Cancel" button while signing in). */
      cancel: () => oauth().cancel(),
      /** Forget the tokens (the user can also remove the app's access at the provider). */
      signOut: (provider: OAuthProvider) => oauth().signOut(id, provider),
    },
    /** Desktop notifications of the kinds this plugin declares (`notifications`). */
    notifications: {
      notifyNew: (kind: string, items: NotifyItem[], options?: { baseline?: boolean; summary?: (count: number) => { title: string; body: string } }) => notifyNew(id, kind, items, options),
      notify: (kind: string, n: { title: string; body: string; open?: NotificationTarget }) => notify(id, kind, n),
      poll: (check: () => Promise<void>, everyMs?: number) => pollForNotifications(check, everyMs),
    },
    ui: {
      NavItem,
      Setting,
      Button,
      Input,
      Textarea,
      Switch,
      Select,
      Dialog,
      DialogContent,
      Tooltip,
      PageHeader,
      Section,
      TodayCard,
      TodayList,
      FolderGlyph,
      FolderLabel,
      useFolderColor,
      confirmDialog,
      showError,
      /** Props for anything that opens a note (click, middle-click for a new tab). */
      noteLinkProps,
      /** A note's editor (no title or toolbar around it), e.g. a folder's own text on its page. */
      NoteEditor: EmbeddedNote,
      cn,
    },
    lib: { basename, dirname, joinPath, effectiveFolderColor, colorHex },
    platform: { isTauri, openExternal },
  };
}

export interface PluginQueryOptions<T> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
}

export type PluginApi = ReturnType<typeof createPluginApi>;

/** What a plugin's main.js returns: its contributions (see types.ts); name, version etc. come from manifest.json. */
export type PluginDefinition = Partial<Omit<Plugin, "id" | "builtIn" | "source" | "error">>;

export type PluginFactory = (api: PluginApi) => PluginDefinition;

/** manifest.json of a community plugin. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** The oldest Forgor version it works with. */
  minAppVersion?: string;
  requires?: string[];
  models?: Plugin["models"];
}
