import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { newId } from "@/lib/utils";

// ------------------------------------------------------------ inline todo markers

const MARKER_RE = /\s?\^t-([a-z0-9]+)/g;
const TRAILING_MARKER = /\^t-[a-z0-9]+\s*$/;

/**
 * Hides `^t-<id>` markers and shows a small clickable "todo" badge instead.
 */
export function inlineTodoDecorations(onOpenTodo: (id: string) => void) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("inline-todo-markers"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const m of node.text.matchAll(MARKER_RE)) {
                const from = pos + m.index!;
                const to = from + m[0].length;
                decos.push(Decoration.inline(from, to, { class: "inline-todo-marker" }));
                decos.push(
                  Decoration.widget(
                    to,
                    () => {
                      const el = document.createElement("span");
                      el.className = "inline-todo-badge";
                      el.title = "Open todo";
                      el.contentEditable = "false";
                      el.dataset.todoId = m[1];
                      el.textContent = "todo";
                      el.addEventListener("mousedown", (e) => {
                        e.preventDefault();
                        onOpenTodo(m[1]);
                      });
                      return el;
                    },
                    { side: 1, key: `todo-${m[1]}` },
                  ),
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
  );
}

/**
 * Append `^t-<id>` markers to task-list items that don't have one yet.
 * The caret is kept in place (before the hidden marker). Returns true if
 * anything changed.
 */
export function assignMarkersInView(view: EditorView): boolean {
  const { state } = view;
  const inserts: number[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "list_item" || node.attrs.checked == null) return;
    const para = node.firstChild;
    if (!para || !para.isTextblock) return;
    const text = para.textContent;
    if (!text.trim() || TRAILING_MARKER.test(text)) return;
    inserts.push(pos + 1 + para.nodeSize - 1);
  });
  if (!inserts.length) return false;
  const { anchor, head } = state.selection;
  const tr = state.tr;
  for (const at of inserts.sort((a, b) => b - a)) tr.insertText(` ^t-${newId()}`, at);
  try {
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(anchor, -1), tr.mapping.map(head, -1)));
  } catch {
    // Non-text selection: let ProseMirror map it.
  }
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
  return true;
}

// ------------------------------------------------------------ wiki links

const WIKI_RE = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;

export function wikiLinkPlugin(opts: { onOpen: (target: string) => void; exists: (target: string) => boolean }) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("wiki-links"),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              if (node.marks.some((m) => m.type.name === "inlineCode" || m.type.name === "code_inline")) return;
              for (const m of node.text.matchAll(WIKI_RE)) {
                const from = pos + m.index!;
                const target = m[1].trim();
                decos.push(
                  Decoration.inline(from, from + m[0].length, {
                    class: opts.exists(target) ? "wikilink" : "wikilink wikilink-missing",
                    "data-target": target,
                    title: opts.exists(target) ? `Open “${target}” (Ctrl/⌘+click)` : `“${target}” doesn't exist yet. Ctrl/⌘+click to create it`,
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement).closest?.(".wikilink") as HTMLElement | null;
            if (!el || !(event.ctrlKey || event.metaKey)) return false;
            opts.onOpen(el.dataset.target!);
            return true;
          },
        },
      }),
  );
}

export interface SuggestState {
  active: boolean;
  query: string;
  /** Document range of the typed query (after "[["). */
  from: number;
  to: number;
  coords: { left: number; bottom: number } | null;
}

const suggestKey = new PluginKey<SuggestState>("wiki-suggest");
const INACTIVE: SuggestState = { active: false, query: "", from: 0, to: 0, coords: null };

function detect(state: EditorState): Omit<SuggestState, "coords"> {
  const sel = state.selection;
  if (!sel.empty) return INACTIVE;
  const $pos = sel.$from;
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return INACTIVE;
  const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  const m = /\[\[([^\]\n|#]*)$/.exec(before);
  if (!m) return INACTIVE;
  return { active: true, query: m[1], from: sel.from - m[1].length, to: sel.from };
}

/**
 * Autocomplete for `[[`. State changes are pushed to React through `onChange`;
 * keyboard navigation is delegated to `onKey` while the popup is open.
 */
export function wikiSuggestPlugin(opts: {
  onChange: (s: SuggestState) => void;
  onKey: (key: "ArrowUp" | "ArrowDown" | "Enter" | "Escape" | "Tab") => boolean;
}) {
  let dismissedAt: number | null = null;
  return $prose(
    () =>
      new Plugin<SuggestState>({
        key: suggestKey,
        view() {
          let last = "";
          return {
            update(view) {
              const d = detect(view.state);
              let s: SuggestState = { ...d, coords: null };
              if (d.active && dismissedAt === d.from) s = INACTIVE;
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
              opts.onChange(INACTIVE);
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            const d = detect(view.state);
            if (!d.active || dismissedAt === d.from) return false;
            if (["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(event.key)) {
              return opts.onKey(event.key as "ArrowUp");
            }
            if (event.key === "Escape") {
              dismissedAt = d.from;
              opts.onChange(INACTIVE);
              return true;
            }
            return false;
          },
        },
      }),
  );
}

/** Replace the typed query with the chosen title and close the brackets. */
export function completeWikiLink(view: EditorView, s: SuggestState, title: string) {
  const after = view.state.doc.textBetween(s.to, Math.min(s.to + 2, view.state.doc.content.size));
  const closing = after === "]]" ? "" : "]]";
  const tr = view.state.tr.insertText(title + closing, s.from, s.to);
  const end = s.from + title.length + 2;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(end, tr.doc.content.size)));
  view.dispatch(tr);
  view.focus();
}

// ------------------------------------------------------------ paste / drop files

export function filePastePlugin(onFiles: (files: File[], view: EditorView, pos: number | null) => void) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("file-paste"),
        props: {
          handlePaste(view, event) {
            const files = [...(event.clipboardData?.files ?? [])];
            if (!files.length) return false;
            onFiles(files, view, null);
            return true;
          },
          handleDrop(view, event) {
            const files = [...((event as DragEvent).dataTransfer?.files ?? [])];
            if (!files.length) return false;
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
            onFiles(files, view, pos);
            return true;
          },
          handleDOMEvents: {
            click(_view, event) {
              // Ctrl/⌘+click on a regular link opens it in the browser.
              const a = (event.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
              if (a && (event.ctrlKey || event.metaKey) && /^(https?:|mailto:)/.test(a.getAttribute("href") ?? "")) {
                event.preventDefault();
                window.dispatchEvent(new CustomEvent("open-external", { detail: a.getAttribute("href") }));
                return true;
              }
              return false;
            },
          },
        },
      }),
  );
}
