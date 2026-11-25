import type { PluginDefinition } from "./api";
import { THEME_TOKENS, tokenName } from "@/lib/themeTokens";

/**
 * What a community plugin returns is checked when it loads: a part with the
 * wrong shape (`shortcuts` as a string, a page without a component…) is
 * dropped and reported on the plugin's card, instead of crashing the app the
 * first time something reads it. Keys the app doesn't know are left alone (a
 * plugin made for a newer Forgor has them).
 */

const isFn = (v: unknown): v is (...args: never[]) => unknown => typeof v === "function";
/** A React component: a function, or a memo/forwardRef object. */
const isComponent = (v: unknown) => isFn(v) || (typeof v === "object" && v !== null && "$$typeof" in v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
/** A CSS color ("#fff", "rgb(…)", "oklch(…)"…); without a browser (tests) a plain shape check. */
const isColor = (v: unknown): v is string =>
  isText(v) && (typeof CSS !== "undefined" && CSS.supports ? CSS.supports("color", v) : /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\)|[a-z]+)$/i.test(v.trim()));

export function sanitizeDefinition(input: unknown): { definition: PluginDefinition; warnings: string[] } {
  const warnings: string[] = [];
  if (!isRecord(input)) {
    return { definition: {}, warnings: ["It returned nothing Forgor can use: the function must return an object with what the plugin adds."] };
  }
  const out: Record<string, unknown> = { ...input };
  const drop = (key: string, why: string) => {
    delete out[key];
    warnings.push(`“${key}” was ignored: ${why}.`);
  };
  const component = (key: string, v: unknown) => v === undefined || isComponent(v) || (drop(key, "it must be a component"), false);
  const fn = (key: string, v: unknown) => v === undefined || isFn(v) || (drop(key, "it must be a function"), false);

  for (const key of ["icon", "settings", "sidebar", "folderSection"]) component(key, out[key]);
  for (const key of ["useWriter", "useQuickMenu", "start", "disableBlocked"]) fn(key, out[key]);

  if (out.pages !== undefined) {
    if (!isRecord(out.pages)) drop("pages", "it must be an object of pages");
    else {
      const pages: Record<string, unknown> = {};
      for (const [name, page] of Object.entries(out.pages)) {
        if (isRecord(page) && isFn(page.useTab) && isComponent(page.component)) pages[name] = page;
        else warnings.push(`Page “${name}” was ignored: it needs a useTab function and a component.`);
      }
      out.pages = pages;
    }
  }
  if (out.panels !== undefined) {
    if (!isRecord(out.panels)) drop("panels", "it must be an object of components");
    else {
      const panels: Record<string, unknown> = {};
      for (const [name, c] of Object.entries(out.panels)) {
        if (isComponent(c)) panels[name] = c;
        else warnings.push(`Panel “${name}” was ignored: it must be a component.`);
      }
      out.panels = panels;
    }
  }
  if (out.noteHeader !== undefined) {
    if (!isRecord(out.noteHeader)) drop("noteHeader", "it must be an object with breadcrumb and/or actions components");
    else {
      const parts: Record<string, unknown> = {};
      for (const key of ["breadcrumb", "actions"]) {
        const c = out.noteHeader[key];
        if (c === undefined) continue;
        if (isComponent(c)) parts[key] = c;
        else warnings.push(`noteHeader.${key} was ignored: it must be a component.`);
      }
      out.noteHeader = parts;
    }
  }
  if (out.today !== undefined) {
    if (!isRecord(out.today)) drop("today", "it must be an object with cards and/or section components");
    else {
      const parts: Record<string, unknown> = {};
      for (const key of ["cards", "section"]) {
        const c = out.today[key];
        if (c === undefined) continue;
        if (isComponent(c)) parts[key] = c;
        else warnings.push(`today.${key} was ignored: it must be a component.`);
      }
      out.today = parts;
    }
  }
  if (out.hosts !== undefined) {
    if (!Array.isArray(out.hosts)) drop("hosts", "it must be a list of components");
    else {
      const ok = out.hosts.filter(isComponent);
      if (ok.length !== out.hosts.length) warnings.push("Some of “hosts” were ignored: they must be components.");
      out.hosts = ok;
    }
  }
  if (out.remoteQueries !== undefined) {
    if (!Array.isArray(out.remoteQueries) || !out.remoteQueries.every(isText)) drop("remoteQueries", "it must be a list of text");
  }
  if (out.notifications !== undefined) {
    if (!Array.isArray(out.notifications)) drop("notifications", "it must be a list");
    else {
      out.notifications = out.notifications.filter((n, i) => {
        const ok = isRecord(n) && isText(n.kind) && isText(n.label) && (n.settings === undefined || isComponent(n.settings));
        if (!ok) warnings.push(`notifications[${i}] was ignored: it needs a kind and a label (and settings must be a component).`);
        return ok;
      });
    }
  }
  if (out.shortcuts !== undefined) {
    if (!Array.isArray(out.shortcuts)) drop("shortcuts", "it must be a list");
    else {
      const seen = new Set<string>();
      out.shortcuts = out.shortcuts.flatMap((s, i) => {
        if (!isRecord(s) || !isText(s.id) || !isText(s.label) || !isFn(s.run)) {
          warnings.push(`shortcuts[${i}] was ignored: it needs an id, a label and a run function.`);
          return [];
        }
        if (seen.has(s.id)) {
          warnings.push(`shortcuts[${i}] was ignored: the id “${s.id}” is used twice.`);
          return [];
        }
        seen.add(s.id);
        if (s.keys !== undefined && !(Array.isArray(s.keys) && s.keys.every(isText))) {
          warnings.push(`The keys of shortcut “${s.id}” were ignored: they must be a list of text like ["Mod+Shift+H"].`);
          return [{ ...s, keys: [] }];
        }
        return [s];
      });
    }
  }
  if (out.themes !== undefined) {
    if (!Array.isArray(out.themes)) drop("themes", "it must be a list");
    else {
      const seen = new Set<string>();
      out.themes = out.themes.flatMap((t, i) => {
        if (!isRecord(t) || !isText(t.id) || !isText(t.name) || (t.light === undefined && t.dark === undefined)) {
          warnings.push(`themes[${i}] was ignored: it needs an id, a name and light and/or dark colors.`);
          return [];
        }
        if (seen.has(t.id)) {
          warnings.push(`themes[${i}] was ignored: the id “${t.id}” is used twice.`);
          return [];
        }
        seen.add(t.id);
        const theme: Record<string, unknown> = { id: t.id, name: t.name };
        for (const mode of ["light", "dark"] as const) {
          const tokens = t[mode];
          if (tokens === undefined) continue;
          if (!isRecord(tokens)) {
            warnings.push(`The ${mode} colors of theme “${t.id}” were ignored: they must be an object like { background: "#fff" }.`);
            continue;
          }
          const kept: Record<string, string> = {};
          for (const [key, value] of Object.entries(tokens)) {
            const name = tokenName(key);
            if (!(THEME_TOKENS as readonly string[]).includes(name)) warnings.push(`Theme “${t.id}”: “${key}” isn't one of Forgor's colors and was ignored.`);
            else if (!isColor(value)) warnings.push(`Theme “${t.id}”: ${mode} “${key}” isn't a CSS color and was ignored.`);
            else kept[name] = value;
          }
          theme[mode] = kept;
        }
        if (!theme.light && !theme.dark) {
          warnings.push(`themes[${i}] was ignored: it has no usable colors.`);
          return [];
        }
        return [theme];
      });
    }
  }
  if (out.editor !== undefined) {
    if (!isRecord(out.editor)) drop("editor", "it must be an object (codeBlockRenderers, slashItems, blockMenuItems)");
    else {
      const editor: Record<string, unknown> = { ...out.editor };
      const renderers = editor.codeBlockRenderers;
      if (renderers !== undefined) {
        if (!isRecord(renderers)) {
          delete editor.codeBlockRenderers;
          warnings.push("“editor.codeBlockRenderers” was ignored: it must be an object of language → component.");
        } else {
          const kept: Record<string, unknown> = {};
          for (const [lang, c] of Object.entries(renderers)) {
            if (isComponent(c)) kept[lang.toLowerCase()] = c;
            else warnings.push(`The code block preview for “${lang}” was ignored: it must be a component.`);
          }
          editor.codeBlockRenderers = kept;
        }
      }
      for (const key of ["slashItems", "blockMenuItems"] as const) {
        const list = editor[key];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
          delete editor[key];
          warnings.push(`“editor.${key}” was ignored: it must be a list.`);
          continue;
        }
        const seen = new Set<string>();
        editor[key] = list.filter((item, i) => {
          const ok = isRecord(item) && isText(item.id) && isText(item.label) && isFn(item.run) && (item.show === undefined || isFn(item.show)) && !seen.has(item.id);
          if (!ok) warnings.push(`editor.${key}[${i}] was ignored: it needs a unique id, a label and a run function.`);
          else seen.add(item.id as string);
          return ok;
        });
      }
      out.editor = editor;
    }
  }
  if (out.items !== undefined && !(isRecord(out.items) && isText(out.items.kind) && isFn(out.items.items))) drop("items", "it needs a kind and an items function");
  if (out.chat !== undefined && !(isRecord(out.chat) && isText(out.chat.kind) && isFn(out.chat.items))) drop("chat", "it needs a kind and an items function");

  return { definition: out as PluginDefinition, warnings };
}
