import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
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
