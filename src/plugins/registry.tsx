import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useUI } from "@/app/store";
import { addRemoteQueries } from "@/app/queries";
import { LEGACY_FLAGS } from "@/data/settings";
import type { WriteFn } from "@/platform/writing";
import type { Plugin } from "./types";
import { isPluginEnabled } from "./host";
import { PluginBoundary } from "./Boundary";
import { showError } from "@/components/Toasts";
import { meetingsPlugin } from "./meetings";
import { writingPlugin } from "./writing";
import { jiraPlugin } from "./jira";
import { bitbucketPlugin } from "./bitbucket";

/**
 * Every plugin the app knows, in the order their contributions appear:
 * the built-in ones, then community plugins (community.tsx). The app reads
 * contributions only through here (and only of enabled plugins).
 */
export const PLUGINS: Plugin[] = [meetingsPlugin, writingPlugin, jiraPlugin, bitbucketPlugin];
const BUILT_IN = PLUGINS.length;

addRemoteQueries(PLUGINS.flatMap((p) => p.remoteQueries ?? []));

/**
 * Bumped when the list of plugins changes (installing, removing, reloading).
 * The app remounts its tree then (App.tsx), so plugin hooks such as
 * `useWriter` always run in the same order within one mount.
 */
export const usePluginsVersion = create<{ version: number }>(() => ({ version: 0 }));

/** Replace the community plugins (after loading them). */
export function setCommunityPlugins(plugins: Plugin[]) {
  PLUGINS.splice(BUILT_IN, PLUGINS.length - BUILT_IN, ...plugins);
  addRemoteQueries(plugins.flatMap((p) => p.remoteQueries ?? []));
  usePluginsVersion.setState((s) => ({ version: s.version + 1 }));
}

export const getPlugin = (id: string) => PLUGINS.find((p) => p.id === id);

export function useEnabledPlugins(): Plugin[] {
  const map = useUI((s) => s.settings.plugins);
  const version = usePluginsVersion((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- PLUGINS changes in place; `version` says when
  return useMemo(() => PLUGINS.filter((p) => map[p.id] === true && !p.error), [map, version]);
}

/** Enabled plugins that need `id` (directly or through another plugin). */
export function dependentsOf(id: string): Plugin[] {
  const settings = useUI.getState().settings;
  const out = new Map<string, Plugin>();
  const walk = (of: string) => {
    for (const p of PLUGINS) {
      if (p.requires?.includes(of) && isPluginEnabled(settings, p.id) && !out.has(p.id)) {
        out.set(p.id, p);
        walk(p.id);
      }
    }
  };
  walk(id);
  return [...out.values()];
}

/**
 * Switch a plugin on or off. On also switches on what it requires; off also
 * switches off what requires it (ask first, see `dependentsOf`). Throws when a
 * plugin can't be switched off right now. Never deletes a plugin's data.
 */
export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const ui = useUI.getState();
  const next = { ...ui.settings.plugins };
  if (on) {
    const enable = (pid: string) => {
      if (next[pid]) return;
      next[pid] = true;
      getPlugin(pid)?.requires?.forEach(enable);
    };
    enable(id);
  } else {
    const off = [getPlugin(id), ...dependentsOf(id)].filter((p): p is Plugin => !!p);
    for (const p of off) {
      const blocked = p.disableBlocked?.();
      if (blocked) throw new Error(`${p.name} can't be disabled right now. ${blocked}`);
    }
    off.forEach((p) => (next[p.id] = false));
    next[id] = false;
  }
  await ui.updateSetting("plugins", next);
  // The flags of 0.5.1, kept in step so going back to that version keeps the choice.
  for (const [pid, key] of Object.entries(LEGACY_FLAGS)) {
    if ((next[pid] === true) !== ui.settings[key]) await ui.updateSetting(key, next[pid] === true);
  }
}

// ---------------------------------------------------------------- contributions the app mounts

/** Runs each enabled plugin's `start` while it stays enabled (main window). */
export function PluginRuntime() {
  const enabled = useEnabledPlugins();
  return (
    <>
      {enabled.map((p) => (
        <PluginMount key={p.id} plugin={p} />
      ))}
    </>
  );
}

function PluginMount({ plugin }: { plugin: Plugin }) {
  useEffect(() => {
    try {
      return plugin.start?.();
    } catch (e) {
      showError(e, `Plugin "${plugin.name}"`);
    }
  }, [plugin]);
  useEffect(() => {
    if (!plugin.styles) return;
    const style = document.createElement("style");
    style.dataset.forgorPlugin = plugin.id;
    style.textContent = plugin.styles;
    document.head.append(style);
    return () => style.remove();
  }, [plugin]);
  return (
    <>
      {plugin.hosts?.map((Host, i) => (
        <PluginBoundary key={i} plugin={plugin.name} quiet>
          <Host />
        </PluginBoundary>
      ))}
    </>
  );
}

/** The editor's AI writing tools: from the first enabled plugin that offers them (null: none). */
export function useEditorWriter(): WriteFn | null {
  const enabled = useEnabledPlugins();
  let found: WriteFn | null = null;
  // The list only changes with a remount (usePluginsVersion), so the hooks run in the same order every render.
  for (const p of PLUGINS.filter((x) => x.useWriter && !x.error)) {
    const w = p.useWriter!();
    if (!found && enabled.includes(p)) found = w;
  }
  return found;
}

/** The quick menu's plugin entries, status lines and title (popup window). */
export function usePluginQuickMenu() {
  const settings = useUI((s) => s.settings);
  // As in useEditorWriter: same hooks in the same order within one mount.
  const parts = PLUGINS.filter((p) => p.useQuickMenu && !p.error).map((p) => p.useQuickMenu!(isPluginEnabled(settings, p.id)));
  return { items: parts.flatMap((p) => p.items), status: parts.map((p) => p.status), title: parts.find((p) => p.title)?.title };
}
