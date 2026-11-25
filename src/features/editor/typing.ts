import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { createToggle } from "./toggle";

/**
 * Notion-style typing (Settings → Shortcuts → Typing): `"` + space at the
 * start of a line makes a quote, `>` + space a toggle. Only typing changes: a
 * quote is still `> text` in the file. Runs on keydown, before the editor's
 * own input rules (which would make `>` a quote).
 */
export function notionTyping(enabled: () => boolean) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("notion-typing"),
        props: {
          handleDOMEvents: {
            keydown: (view, e) => {
              if (e.key !== " " || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || !enabled()) return false;
              const { state } = view;
              const { $from, empty } = state.selection;
              const para = $from.parent;
              if (!empty || para.type.name !== "paragraph" || $from.parentOffset !== 1) return false;
              const ch = para.textContent[0];
              const quote = ch === '"' || ch === "“" || ch === "”";
              if (!quote && ch !== ">") return false;
              e.preventDefault();
              const start = $from.before();
              const rest = para.content.cut(1);
              const { schema } = state;
              const tr = state.tr;
              if (quote) {
                const p = schema.nodes.paragraph.create(null, rest);
                tr.replaceWith(start, start + para.nodeSize, schema.nodes.blockquote.create(null, p));
                tr.setSelection(TextSelection.create(tr.doc, start + 2));
              } else {
                tr.replaceWith(start, start + para.nodeSize, createToggle(schema, rest));
                tr.setSelection(TextSelection.create(tr.doc, start + 2));
              }
              view.dispatch(tr.scrollIntoView());
              return true;
            },
          },
        },
      }),
  );
}
