import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";

/**
 * Long lists of short items flow into columns when the note is wide enough
 * (CSS columns, editor.css `.list-columns`): one long column otherwise leaves
 * the width empty. Nothing changes in the file. Off with
 * Settings → Appearance → "Lists in columns".
 */

/** At least this many items… */
export const MIN_ITEMS = 8;
/** …each a single line of at most this many characters, without sub-lists. */
export const MAX_ITEM_LENGTH = 40;

const MARKER = /\s*\^t-[a-z0-9]+\s*$/;

export function fitsColumns(list: ProseNode): boolean {
  if (list.childCount < MIN_ITEMS) return false;
  let fits = true;
  list.forEach((item) => {
    if (!fits) return;
    if (item.childCount !== 1 || !item.firstChild?.isTextblock) fits = false;
    else if (item.firstChild.textContent.replace(MARKER, "").length > MAX_ITEM_LENGTH) fits = false;
  });
  return fits;
}

export function listColumns(enabled: () => boolean) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("list-columns"),
        props: {
          decorations(state) {
            if (!enabled()) return null;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "bullet_list" && node.type.name !== "ordered_list") return true;
              if (fitsColumns(node)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "list-columns" }));
              return false; // lists inside lists aren't split up
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
  );
}
