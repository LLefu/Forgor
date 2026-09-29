import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import type { Mark, Node as PMNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { mentionHref, parseMentionHref, type MentionKind } from "@/lib/mentions";
import { fileKind } from "@/lib/files";

// ------------------------------------------------------------ link ranges

export interface LinkRange {
  from: number;
  to: number;
  href: string;
  /** The link's markdown title ("…"); video links keep their width there ("width=480"). */
  title: string | null;
  text: string;
}

/** Every link in the document as one range per link (a link can span several text nodes). */
export function linkRanges(doc: PMNode): LinkRange[] {
  const out: LinkRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (node.type.spec.code) return false;
    let cur: (LinkRange & { mark: Mark }) | null = null;
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const mark = child.isText ? child.marks.find((m) => m.type.name === "link") : undefined;
      if (mark && cur && cur.mark.eq(mark) && cur.to === start) {
        cur.to = start + child.nodeSize;
        cur.text += child.text;
        return;
      }
      if (cur) out.push(cur);
      cur = mark ? { from: start, to: start + child.nodeSize, href: String(mark.attrs.href ?? ""), title: (mark.attrs.title as string | null) ?? null, text: child.text ?? "", mark } : null;
    });
    if (cur) out.push(cur);
    return false;
  });
  return out;
}

/** A link to a file in the vault (relative path, no scheme), e.g. an attachment added with /document. */
export const isFileHref = (href: string) => !!href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#");

// ------------------------------------------------------------ rendering + clicks

const ICONS: Record<MentionKind | "file" | "video" | "audio", string> = {
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  note: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  embed: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  todo: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
};

function iconEl(kind: MentionKind | "file" | "video" | "audio") {
  const el = document.createElement("span");
  el.className = `link-icon link-icon-${kind}`;
  el.contentEditable = "false";
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
  return el;
}

export interface MentionTarget {
  kind: MentionKind;
  id: string;
  from: number;
  to: number;
  text: string;
}

export interface LinkPluginOptions {
  /** Does the note/todo/folder still exist? Missing targets are struck through. */
  exists: (kind: MentionKind, id: string) => boolean;
  onMentionClick: (target: MentionTarget, rect: DOMRect, direct: boolean) => void;
  onOpenFile: (href: string) => void;
  /** Mount a player for a video/audio link into `el`; returns a cleanup function. */
  renderMedia: (el: HTMLElement, media: MediaSpec) => () => void;
  /** Mount a read-only view of a note into `el`; returns a cleanup function. */
  renderEmbed: (el: HTMLElement, noteId: string) => () => void;
  onEmbedShowAsLink: (target: MentionTarget) => void;
}

export const refreshLinksKey = new PluginKey("refresh-links");

/**
 * Styles "@" links (icon + pill), attachment links (paperclip; a click opens
 * the file) and embedded notes (the whole note shown below its title line).
 */
export function linkPlugin(opts: LinkPluginOptions) {
  return $prose(
    () =>
      new Plugin({
        key: refreshLinksKey,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const seen = new Map<string, number>();
            for (const r of linkRanges(state.doc)) {
              const mention = parseMentionHref(r.href);
              if (mention) {
                const { kind, id } = mention;
                const $from = state.doc.resolve(r.from);
                const para = $from.parent;
                const alone = kind === "embed" && para.type.name === "paragraph" && para.textContent.trim() === r.text.trim();
                const shownKind: MentionKind = kind === "embed" && !alone ? "note" : kind;
                const exists = opts.exists(kind === "embed" ? "note" : kind, id);
                decos.push(
                  Decoration.inline(r.from, r.to, {
                    class: `mention mention-${shownKind}${exists ? "" : " mention-missing"}`,
                    "data-mention-kind": kind,
                    "data-mention-id": id,
                    title: exists ? "Click for options · Ctrl/⌘+click to open" : "This no longer exists",
                  }),
                );
                decos.push(Decoration.widget(r.from, () => iconEl(shownKind), { side: -1, key: `mi-${shownKind}-${r.from}`, ignoreSelection: true }));
                if (alone && exists) {
                  const after = $from.after($from.depth);
                  const target: MentionTarget = { kind, id, from: r.from, to: r.to, text: r.text };
                  decos.push(Decoration.node($from.before($from.depth), after, { class: "note-embed-title" }));
                  // "Open" / "Show as link" on the right of the title line.
                  decos.push(
                    Decoration.widget(
                      after - 1,
                      () => {
                        const bar = document.createElement("span");
                        bar.className = "note-embed-bar";
                        bar.contentEditable = "false";
                        const button = (label: string, onClick: () => void) => {
                          const b = document.createElement("button");
                          b.type = "button";
                          b.textContent = label;
                          b.addEventListener("mousedown", (e) => e.preventDefault());
                          b.addEventListener("click", (e) => {
                            e.preventDefault();
                            onClick();
                          });
                          return b;
                        };
                        bar.append(
                          button("Open", () => opts.onMentionClick({ ...target, kind: "note" }, bar.getBoundingClientRect(), true)),
                          button("Show as link", () => opts.onEmbedShowAsLink(target)),
                        );
                        return bar;
                      },
                      { side: 1, key: `embed-bar-${id}`, ignoreSelection: true, stopEvent: () => true },
                    ),
                  );
                  decos.push(
                    Decoration.widget(
                      after,
                      () => {
                        const el = document.createElement("div");
                        el.className = "note-embed";
                        el.contentEditable = "false";
                        const cleanup = opts.renderEmbed(el, id);
                        (el as HTMLElement & { _cleanup?: () => void })._cleanup = cleanup;
                        return el;
                      },
                      {
                        side: -1,
                        key: `embed-${id}`,
                        ignoreSelection: true,
                        stopEvent: () => true,
                        destroy: (node) => (node as HTMLElement & { _cleanup?: () => void })._cleanup?.(),
                      },
                    ),
                  );
                }
              } else if (isFileHref(r.href)) {
                // A video/audio link alone in its paragraph gets a player below it.
                const kind = fileKind(r.href);
                const $from = state.doc.resolve(r.from);
                const para = $from.parent;
                if ((kind === "video" || kind === "audio") && para.type.name === "paragraph" && para.textContent.trim() === r.text.trim()) {
                  const after = $from.after($from.depth);
                  const n = (seen.get(r.href) ?? 0) + 1;
                  seen.set(r.href, n);
                  decos.push(
                    Decoration.widget(
                      after,
                      (view, getPos) => {
                        const wrap = document.createElement("div");
                        wrap.className = `media-player media-${kind}`;
                        wrap.contentEditable = "false";
                        const cleanup = opts.renderMedia(wrap, {
                          kind,
                          href: r.href,
                          name: decodeURIComponentSafe(r.href.split("/").pop() ?? r.href),
                          width: parseWidth(r.title),
                          onResize: (width) => {
                            const pos = getPos();
                            if (pos !== undefined) setMediaWidth(view, pos, width);
                          },
                        });
                        (wrap as HTMLElement & { _cleanup?: () => void })._cleanup = cleanup;
                        return wrap;
                      },
                      // Same key while the link is unchanged: the player (and playback) survives edits elsewhere.
                      {
                        side: -1,
                        key: `media-${r.href}-${n}`,
                        ignoreSelection: true,
                        stopEvent: () => true,
                        destroy: (node) => (node as HTMLElement & { _cleanup?: () => void })._cleanup?.(),
                      },
                    ),
                  );
                }
                decos.push(Decoration.inline(r.from, r.to, { class: "file-link", "data-file-href": r.href, title: `Open ${decodeURI(r.href.split("/").pop() ?? r.href)}` }));
                const icon = kind === "video" || kind === "audio" ? kind : "file";
                decos.push(Decoration.widget(r.from, () => iconEl(icon), { side: -1, key: `fi-${icon}-${r.from}`, ignoreSelection: true }));
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
          handleClick(view, pos, event) {
            const el = event.target as HTMLElement;
            const mentionEl = el.closest?.("[data-mention-id]") as HTMLElement | null;
            if (mentionEl) {
              const r = linkRanges(view.state.doc).find((l) => pos >= l.from && pos <= l.to && parseMentionHref(l.href));
              const m = r && parseMentionHref(r.href);
              if (!r || !m) return false;
              event.preventDefault();
              opts.onMentionClick({ ...m, from: r.from, to: r.to, text: r.text }, mentionEl.getBoundingClientRect(), event.ctrlKey || event.metaKey);
              return true;
            }
            const fileEl = el.closest?.("[data-file-href]") as HTMLElement | null;
            if (fileEl) {
              event.preventDefault();
              opts.onOpenFile(fileEl.dataset.fileHref!);
              return true;
            }
            return false;
          },
        },
      }),
  );
}

export interface MediaSpec {
  kind: "video" | "audio";
  href: string;
  name: string;
  width: number | null;
  onResize: (width: number) => void;
}

const parseWidth = (title: string | null) => {
  const m = /(?:^|s)width=(d+)/.exec(title ?? "");
  return m ? Number(m[1]) : null;
};

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Save a video's width in its link title; `widgetPos` is the player's position (right after the paragraph). */
function setMediaWidth(view: EditorView, widgetPos: number, width: number) {
  const $end = view.state.doc.resolve(widgetPos);
  const para = $end.nodeBefore;
  if (!para) return;
  const start = widgetPos - para.nodeSize;
  const link = linkRanges(view.state.doc).find((l) => l.from > start && l.to < widgetPos);
  if (!link) return;
  const type = view.state.schema.marks.link;
  const title = [link.title?.replace(/(?:^|s)width=d+/, "").trim(), `width=${width}`].filter(Boolean).join(" ");
  view.dispatch(view.state.tr.removeMark(link.from, link.to, type).addMark(link.from, link.to, type.create({ href: link.href, title })));
}

/** Force decorations to recompute (e.g. when the list of notes changed). */
export function refreshLinks(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(refreshLinksKey, true).setMeta("addToHistory", false));
}

// ------------------------------------------------------------ editing helpers

/** Replace `from..to` (the typed "@query") with a link to the target, followed by a space. */
export function insertMention(view: EditorView, from: number, to: number, title: string, kind: MentionKind, id: string) {
  const { schema } = view.state;
  const link = schema.marks.link.create({ href: mentionHref(kind, id) });
  const tr = view.state.tr.replaceWith(from, to, [schema.text(title, [link]), schema.text(" ")]);
  tr.setSelection(TextSelection.create(tr.doc, from + title.length + 1));
  tr.removeStoredMark(schema.marks.link);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Change a link's target (e.g. note ⇄ embed). */
export function setLinkHref(view: EditorView, from: number, to: number, href: string) {
  const link = view.state.schema.marks.link;
  view.dispatch(view.state.tr.removeMark(from, to, link).addMark(from, to, link.create({ href })));
}

/** Keep the text, drop the link. */
export function unlink(view: EditorView, from: number, to: number) {
  view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks.link));
  view.focus();
}

/**
 * "Show entire note": an embed needs a paragraph of its own. If the link sits
 * in running text, it moves to a new paragraph right below.
 */
export function showAsEmbed(view: EditorView, t: MentionTarget) {
  const { state } = view;
  const $from = state.doc.resolve(t.from);
  const para = $from.parent;
  const link = state.schema.marks.link.create({ href: mentionHref("embed", t.id) });
  if (para.type.name === "paragraph" && para.textContent.trim() === t.text.trim()) {
    view.dispatch(state.tr.removeMark(t.from, t.to, state.schema.marks.link).addMark(t.from, t.to, link));
    return;
  }
  // Take one neighbouring space along so no double space is left behind.
  const before = state.doc.textBetween(Math.max($from.start(), t.from - 1), t.from);
  const after = state.doc.textBetween(t.to, Math.min($from.end(), t.to + 1));
  const tr = state.tr.delete(t.from, t.to + (after === " " && (before === " " || t.from === $from.start()) ? 1 : 0));
  const at = tr.mapping.map($from.after(1));
  tr.insert(at, state.schema.nodes.paragraph.create(null, state.schema.text(t.text, [link])));
  view.dispatch(tr);
}

// ------------------------------------------------------------ "@" autocomplete

export interface MentionSuggestState {
  active: boolean;
  query: string;
  /** Range of "@query" in the document. */
  from: number;
  to: number;
  coords: { left: number; bottom: number } | null;
}

const MENTION_INACTIVE: MentionSuggestState = { active: false, query: "", from: 0, to: 0, coords: null };

/**
 * "@" opens the picker only at the start of a word, so e-mail addresses
 * ("me@work.com") never trigger it. The query may contain spaces (titles do).
 */
function detectMention(state: EditorState): Omit<MentionSuggestState, "coords"> {
  const sel = state.selection;
  if (!sel.empty) return MENTION_INACTIVE;
  const $pos = sel.$from;
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return MENTION_INACTIVE;
  if ($pos.marks().some((m) => m.type.name === "link" || m.type.name === "inlineCode" || m.type.name === "code_inline")) return MENTION_INACTIVE;
  const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  const m = /(?:^|[\s([{"'“‘])@((?:[^\s@][^@\n]{0,59})?)$/.exec(before);
  if (!m) return MENTION_INACTIVE;
  return { active: true, query: m[1], from: sel.from - m[1].length - 1, to: sel.from };
}

export function mentionSuggestPlugin(opts: {
  onChange: (s: MentionSuggestState) => void;
  onKey: (key: "ArrowUp" | "ArrowDown" | "Enter" | "Escape" | "Tab") => boolean;
}) {
  let dismissedAt: number | null = null;
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("mention-suggest"),
        view() {
          let last = "";
          return {
            update(view) {
              const d = detectMention(view.state);
              let s: MentionSuggestState = { ...d, coords: null };
              if (d.active && dismissedAt === d.from) s = MENTION_INACTIVE;
              if (!d.active) dismissedAt = null;
              if (s.active) {
                const c = view.coordsAtPos(s.to);
                s.coords = { left: c.left, bottom: c.bottom };
              }
              const sig = JSON.stringify(s);
              if (sig !== last) {
                last = sig;
                opts.onChange(s);
              }
            },
            destroy() {
              opts.onChange(MENTION_INACTIVE);
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            const d = detectMention(view.state);
            if (!d.active || dismissedAt === d.from) return false;
            if (["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(event.key)) return opts.onKey(event.key as "Enter");
            if (event.key === "Escape") {
              dismissedAt = d.from;
              opts.onChange(MENTION_INACTIVE);
              return true;
            }
            return false;
          },
        },
      }),
  );
}

// ------------------------------------------------------------ find in note

interface FindState {
  query: string;
  index: number;
  matches: { from: number; to: number }[];
}
export const findKey = new PluginKey<FindState>("find-in-note");

/** Case-insensitive matches per text block (so a match may cross bold/italic boundaries). */
function findMatches(doc: PMNode, query: string) {
  const out: { from: number; to: number }[] = [];
  const q = query.toLowerCase();
  if (!q) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(start + i);
        text += child.text;
      } else {
        map.push(start);
        text += "￼";
      }
    });
    const lower = text.toLowerCase();
    for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) {
      out.push({ from: map[i], to: map[i + q.length - 1] + 1 });
    }
    return false;
  });
  return out;
}

export function findPlugin() {
  return $prose(
    () =>
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: "", index: 0, matches: [] }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const matches = findMatches(tr.doc, query);
            const index = matches.length ? (((meta?.index ?? prev.index) % matches.length) + matches.length) % matches.length : 0;
            return { query, index, matches };
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s?.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.index ? "find-match find-current" : "find-match" })),
            );
          },
        },
      }),
  );
}

/** Set the search text and/or move to a match; returns the position shown as "index / count". */
export function setFind(view: EditorView, patch: { query?: string; index?: number }): { index: number; count: number } {
  view.dispatch(view.state.tr.setMeta(findKey, patch).setMeta("addToHistory", false));
  const s = findKey.getState(view.state)!;
  return { index: s.matches.length ? s.index + 1 : 0, count: s.matches.length };
}

export function currentFind(view: EditorView) {
  return findKey.getState(view.state);
}
