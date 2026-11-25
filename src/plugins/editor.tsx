import { useMemo, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/app/queries";
import { useEnabledPlugins } from "./registry";
import { PluginBoundary } from "./Boundary";
import { reportPluginFault } from "./host";
import type { Plugin, PluginBlockMenuItem, PluginSlashItem } from "./types";

/**
 * What enabled plugins add to the note editor (`editor`): previews under code
 * blocks, "/" items and drag-handle menu items. The editor never runs plugin
 * code bare: actions go through `runSafely`, previews render in their own
 * root inside a PluginBoundary, so a broken plugin is switched off (community)
 * or reported (built-in) and the note keeps working.
 */

export interface EditorExtensions {
  /** Changes when the set changes, so the editor is built again. */
  key: string;
  slashItems: { plugin: Plugin; item: PluginSlashItem }[];
  blockMenuItems: { plugin: Plugin; item: PluginBlockMenuItem }[];
  renderers: Map<string, { plugin: Plugin; component: ComponentType<{ code: string }> }>;
}

export function useEditorExtensions(): EditorExtensions {
  const plugins = useEnabledPlugins();
  return useMemo(() => {
    const withEditor = plugins.filter((p) => p.editor);
    const renderers = new Map<string, { plugin: Plugin; component: ComponentType<{ code: string }> }>();
    for (const p of withEditor)
      for (const [lang, component] of Object.entries(p.editor!.codeBlockRenderers ?? {})) {
        if (!renderers.has(lang.toLowerCase())) renderers.set(lang.toLowerCase(), { plugin: p, component });
      }
    return {
      key: withEditor.map((p) => p.id).join(","),
      slashItems: withEditor.flatMap((p) => (p.editor!.slashItems ?? []).map((item) => ({ plugin: p, item }))),
      blockMenuItems: withEditor.flatMap((p) => (p.editor!.blockMenuItems ?? []).map((item) => ({ plugin: p, item }))),
      renderers,
    };
  }, [plugins]);
}

/** Run a plugin's action; what it throws (now or later) is reported against the plugin. */
export function runSafely(plugin: Plugin, fn: () => unknown) {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((e) => reportPluginFault(plugin.id, e, "the editor"));
  } catch (e) {
    reportPluginFault(plugin.id, e, "the editor");
  }
}

/** Whether a plugin's `show` lets an item appear (a throwing `show` hides it and is reported). */
export function shows(plugin: Plugin, show: (() => boolean) | undefined): boolean {
  if (!show) return true;
  try {
    return !!show();
  } catch (e) {
    reportPluginFault(plugin.id, e, "the editor");
    return false;
  }
}

/**
 * Code block previews for one editor. Crepe puts what we return into the page
 * as sanitized HTML (an element would be copied, empty), so we return a
 * placeholder and mount the plugin's component into it once it's there. Roots
 * whose element left the page are unmounted on the next render, and all of
 * them when the editor goes.
 */
export function codePreviews(extensions: () => EditorExtensions) {
  const roots = new Map<HTMLElement, Root>();
  let next = 0;
  let destroyed = false;
  const sweep = (all = false) => {
    for (const [el, root] of roots)
      if (all || !el.isConnected) {
        roots.delete(el);
        // Not during React's own render (Crepe calls us from its own updates).
        queueMicrotask(() => root.unmount());
      }
  };
  const mount = (id: string, plugin: Plugin, Preview: ComponentType<{ code: string }>, code: string, tries = 10) => {
    if (destroyed) return;
    const el = document.querySelector<HTMLElement>(`[data-preview-id="${id}"]`);
    if (!el) {
      if (tries > 0) requestAnimationFrame(() => mount(id, plugin, Preview, code, tries - 1));
      return;
    }
    const root = createRoot(el);
    root.render(
      <QueryClientProvider client={queryClient}>
        <PluginBoundary id={plugin.id} plugin={plugin.name}>
          <Preview code={code} />
        </PluginBoundary>
      </QueryClientProvider>,
    );
    roots.set(el, root);
  };
  return {
    render(language: string, code: string): string | null {
      sweep();
      const found = extensions().renderers.get(language.toLowerCase());
      if (!found) return null;
      const id = `p${Date.now().toString(36)}${next++}`;
      requestAnimationFrame(() => mount(id, found.plugin, found.component, code));
      return `<div class="plugin-code-preview" data-preview-id="${id}"></div>`;
    },
    destroy: () => {
      destroyed = true;
      sweep(true);
    },
  };
}
