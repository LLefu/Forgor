import { memo, useEffect, useMemo, type ReactNode } from "react";
import { create } from "zustand";
import { useUI } from "@/app/store";
import { addRemoteQueries } from "@/app/queries";
import { LEGACY_FLAGS } from "@/data/settings";
import type { WriteFn } from "@/platform/writing";
import type { Plugin, QuickMenuItem } from "./types";
import { isPluginEnabled, reloadPlugins, reportPluginFault, setEnabledPluginsLookup, setFaultHandler } from "./host";
import { errorMessage } from "./faults";
import { PluginBoundary } from "./Boundary";
import { showError, showNotice } from "@/components/Toasts";
import { meetingsPlugin } from "./meetings";
import { writingPlugin } from "./writing";
import { jiraPlugin } from "./jira";
import { bitbucketPlugin } from "./bitbucket";
import { chatPlugin } from "./chat";

/**
 * Every plugin the app knows, in the order their contributions appear:
 * the built-in ones, then community plugins (community.tsx). The app reads
 * contributions only through here (and only of enabled plugins).
 */
export const PLUGINS: Plugin[] = [meetingsPlugin, writingPlugin, jiraPlugin, bitbucketPlugin, chatPlugin];
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

setEnabledPluginsLookup(() => PLUGINS.filter((p) => useUI.getState().settings.plugins[p.id] === true && !p.error));

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
export async function setPluginEnabled(id: string, on: boolean, opts: { force?: boolean } = {}): Promise<void> {
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
      const blocked = opts.force ? null : p.disableBlocked?.();
      if (blocked) throw new Error(`${p.name} can't be disabled right now. ${blocked}`);
    }
    off.forEach((p) => (next[p.id] = false));
    next[id] = false;
  }
  // Switched on by hand: the "caused an error" label goes and it may try again. This is set first and in the same
  // breath as the flag below: the plugin can fail again the moment it is on, and that new fault must not have its
  // label cleared afterwards.
  const saves: Promise<void>[] = [];
  if (on) {
    const faults = { ...ui.settings.pluginFaults };
    if (faults[id]) {
      delete faults[id];
      saves.push(ui.updateSetting("pluginFaults", faults));
    }
  }
  saves.push(ui.updateSetting("plugins", next));
  await Promise.all(saves);
  // A plugin switched off after an error isn't even loaded: load it now.
  if (on && getPlugin(id)?.deferred) await reloadPlugins();
  // The flags of 0.5.1, kept in step so going back to that version keeps the choice.
  for (const [pid, key] of Object.entries(LEGACY_FLAGS)) {
    if ((next[pid] === true) !== ui.settings[key]) await ui.updateSetting(key, next[pid] === true);
  }
}

// ---------------------------------------------------------------- a plugin that causes trouble

/**
 * A community plugin caused an error (a crash in what it renders, an uncaught
 * error from its code…): switch it off at once, say so, and keep why, so its
 * card carries a label until the user switches it on again. A built-in plugin
 * is part of the app: its error is shown, not acted on.
 */
setFaultHandler((id, error, where) => {
  const plugin = getPlugin(id);
  if (!plugin || plugin.builtIn) {
    showError(error, plugin ? `${plugin.name} (${where})` : `Plugin "${id}" (${where})`);
    return;
  }
  const ui = useUI.getState();
  // Already off (a second error from the same plugin, in the same breath: the flag below is set right away).
  if (ui.settings.plugins[id] !== true) return;
  const message = errorMessage(error);
  console.error(`Plugin "${id}" switched off (${where})`, error);
  // Both settings change right now (the state is set before the saves are awaited): a boundary that retries
  // straight away already finds the plugin off.
  void Promise.all([
    ui.updateSetting("pluginFaults", { ...ui.settings.pluginFaults, [id]: { message, where, at: new Date().toISOString() } }),
    setPluginEnabled(id, false, { force: true }),
  ]).catch((e) => console.error(`Could not switch off plugin "${id}"`, e));
  showNotice(`${plugin.name} was switched off`, `It caused an error (${where}): ${message}`);
});

// ---------------------------------------------------------------- contributions the app mounts

/** Runs each enabled plugin's `start` while it stays enabled (main window). */
export function PluginRuntime() {
  const enabled = useEnabledPlugins();
  return (
    <>
      {enabled.map((p) => (
        <PluginMount key={p.id} plugin={p} />
      ))}
      <WriterProbes />
    </>
  );
}

function PluginMount({ plugin }: { plugin: Plugin }) {
  useEffect(() => {
    let stop: (() => void) | undefined;
    try {
      stop = plugin.start?.();
    } catch (e) {
      reportPluginFault(plugin.id, e, "starting");
    }
    return () => {
      try {
        stop?.();
      } catch (e) {
        reportPluginFault(plugin.id, e, "stopping");
      }
    };
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
        <PluginBoundary key={i} id={plugin.id} plugin={plugin.name} quiet>
          <Host />
        </PluginBoundary>
      ))}
    </>
  );
}

// A plugin's hooks (`useWriter`, `useQuickMenu`) run in a small component of their own, inside the plugin's
// boundary, and hand their result to a store. Called from the app's own components (the editor, the popup) a
// throwing plugin hook took the whole screen down.

const useWriters = create<{ byId: Record<string, WriteFn | null> }>(() => ({ byId: {} }));

function WriterProbe({ plugin }: { plugin: Plugin }) {
  const writer = plugin.useWriter!();
  useEffect(() => {
    useWriters.setState((s) => ({ byId: { ...s.byId, [plugin.id]: writer } }));
    return () => useWriters.setState((s) => ({ byId: { ...s.byId, [plugin.id]: null } }));
  }, [plugin.id, writer]);
  return null;
}

/** Mount once in the main window: runs each enabled plugin's `useWriter`. */
export const WriterProbes = memo(function WriterProbes() {
  const enabled = useEnabledPlugins();
  return (
    <>
      {enabled
        .filter((p) => p.useWriter)
        .map((p) => (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name} quiet>
            <WriterProbe plugin={p} />
          </PluginBoundary>
        ))}
    </>
  );
});

/** The editor's AI writing tools: from the first enabled plugin that offers them (null: none). */
export function useEditorWriter(): WriteFn | null {
  const enabled = useEnabledPlugins();
  const byId = useWriters((s) => s.byId);
  return enabled.map((p) => byId[p.id]).find((w): w is WriteFn => !!w) ?? null;
}

interface QuickMenuPart {
  items: QuickMenuItem[];
  status?: ReactNode;
  title?: string;
}
const useQuickMenuParts = create<{ byId: Record<string, QuickMenuPart> }>(() => ({ byId: {} }));

function QuickMenuProbe({ plugin }: { plugin: Plugin }) {
  const part = plugin.useQuickMenu!(true);
  // Every render of this component only (the host below doesn't re-render with its parent: it is memoised).
  useEffect(() => {
    useQuickMenuParts.setState((s) => ({ byId: { ...s.byId, [plugin.id]: part } }));
  });
  useEffect(
    () => () =>
      useQuickMenuParts.setState((s) => {
        const { [plugin.id]: _gone, ...rest } = s.byId;
        return { byId: rest };
      }),
    [plugin.id],
  );
  return null;
}

/** Mount once in the popup window: runs each enabled plugin's `useQuickMenu`. */
export const QuickMenuProbes = memo(function QuickMenuProbes() {
  const enabled = useEnabledPlugins();
  return (
    <>
      {enabled
        .filter((p) => p.useQuickMenu)
        .map((p) => (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name} quiet>
            <QuickMenuProbe plugin={p} />
          </PluginBoundary>
        ))}
    </>
  );
});

/** The quick menu's plugin entries, status lines and title (popup window). */
export function usePluginQuickMenu() {
  const enabled = useEnabledPlugins();
  const byId = useQuickMenuParts((s) => s.byId);
  const parts = enabled.map((p) => byId[p.id]).filter((x): x is QuickMenuPart => !!x);
  return { items: parts.flatMap((p) => p.items), status: parts.map((p) => p.status), title: parts.find((p) => p.title)?.title };
}
