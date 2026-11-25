import { $nodeSchema, $remark, $view } from "@milkdown/kit/utils";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { Fragment, type Node as ProseNode, type Schema } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";

/**
 * Toggle: a block with a title line that folds its content away. Stored as
 * HTML, which GitHub and Obsidian show the same way:
 *
 *   <details>
 *   <summary>Title</summary>
 *
 *   content (markdown)
 *
 *   </details>
 *
 * Folding isn't saved in the file: a note opens with its toggles closed.
 */

type MdNode = { type: string; value?: string; summary?: string; children?: MdNode[] };

const OPEN_TAG = /^<details(?:\s[^>]*)?>/i;
const SUMMARY = /^\s*<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i;
const CLOSE_TAG = /<\/details>\s*$/i;

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const paragraph = (text: string): MdNode => ({ type: "paragraph", children: [{ type: "text", value: text }] });

interface Frame {
  node: MdNode;
  summary: string;
  children: MdNode[];
}

/** An html block's text. Milkdown's own remark step has already put block html in a paragraph of its own. */
function htmlOf(node: MdNode): string {
  if (node.type === "html") return (node.value ?? "").trim();
  if (node.type === "paragraph" && node.children?.length === 1 && node.children[0].type === "html") return (node.children[0].value ?? "").trim();
  return "";
}

/** `<details>` … `</details>` html blocks (and what lies between) become "toggle" nodes, at every level. */
function toggles(children: MdNode[]): MdNode[] {
  for (const c of children) if (c.children && c.type !== "html") c.children = toggles(c.children);
  const out: MdNode[] = [];
  const stack: Frame[] = [];
  const add = (n: MdNode) => (stack.length ? stack[stack.length - 1].children : out).push(n);
  const close = () => {
    const f = stack.pop()!;
    add({ type: "toggle", summary: f.summary, children: f.children });
  };
  for (const node of children) {
    const value = htmlOf(node);
    if (value && OPEN_TAG.test(value)) {
      let rest = value.replace(OPEN_TAG, "");
      const s = SUMMARY.exec(rest);
      if (s) rest = rest.slice(s[0].length);
      const closes = CLOSE_TAG.test(rest);
      if (closes) rest = rest.replace(CLOSE_TAG, "");
      stack.push({ node, summary: s ? decode(s[1]) : "", children: [] });
      if (rest.trim()) add(paragraph(decode(rest)));
      if (closes) close();
    } else if (value && /^<\/details>$/i.test(value) && stack.length) close();
    else add(node);
  }
  // Never closed: put back what was there, untouched.
  while (stack.length) {
    const f = stack.pop()!;
    (stack.length ? stack[stack.length - 1].children : out).push(f.node, ...f.children);
  }
  return out;
}

export function toggleTree(tree: MdNode) {
  if (tree.children) tree.children = toggles(tree.children);
}

export const remarkToggle = $remark("remarkToggle", () => (() => (tree: MdNode) => toggleTree(tree)) as unknown as RemarkPluginRaw<unknown>);

export const toggleSummarySchema = $nodeSchema("toggle_summary", () => ({
  content: "text*",
  marks: "",
  defining: true,
  parseDOM: [{ tag: "summary" }, { tag: "div.toggle-summary" }],
  toDOM: () => ["div", { class: "toggle-summary", "data-placeholder": "Toggle" }, 0],
  // Read and written by the toggle itself.
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: { match: () => false, runner: () => {} },
}));

export const toggleSchema = $nodeSchema("toggle", (ctx) => ({
  group: "block",
  content: "toggle_summary block*",
  defining: true,
  attrs: { open: { default: true } },
  parseDOM: [{ tag: "details", getAttrs: (dom) => ({ open: (dom as HTMLElement).hasAttribute("open") }) }],
  toDOM: (node) => ["details", node.attrs.open ? { open: "" } : {}, 0],
  parseMarkdown: {
    match: (node) => node.type === "toggle",
    runner: (state, node, type) => {
      state.openNode(type, { open: false });
      state.openNode(toggleSummarySchema.type(ctx));
      const summary = String(node.summary ?? "");
      if (summary) state.addText(summary);
      state.closeNode();
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "toggle",
    runner: (state, node) => {
      state.addNode("html", undefined, `<details>\n<summary>${encode(node.firstChild?.textContent ?? "")}</summary>`);
      state.next(node.content.cut(node.firstChild?.nodeSize ?? 0));
      state.addNode("html", undefined, "</details>");
    },
  },
}));

/** The arrow folds the toggle; folding isn't part of the note (kept out of undo). */
export const toggleView = $view(toggleSchema.node, () => (initial, view, getPos) => {
  let node = initial;
  const dom = document.createElement("div");
  dom.className = "toggle-block";
  const arrow = document.createElement("button");
  arrow.type = "button";
  arrow.className = "toggle-arrow";
  arrow.contentEditable = "false";
  arrow.setAttribute("aria-label", "Open or close");
  arrow.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  const body = document.createElement("div");
  body.className = "toggle-content";
  dom.append(arrow, body);
  const show = () => {
    dom.toggleAttribute("data-open", !!node.attrs.open);
    arrow.setAttribute("aria-expanded", String(!!node.attrs.open));
  };
  show();
  arrow.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(setOpen(view.state.tr, pos, !node.attrs.open));
  });
  return {
    dom,
    contentDOM: body,
    update: (next) => {
      if (next.type !== node.type) return false;
      node = next;
      show();
      return true;
    },
    ignoreMutation: (m) => m.target === arrow || arrow.contains(m.target as Node),
    stopEvent: (e) => e.target === arrow || arrow.contains(e.target as Node),
  };
});

const setOpen = (tr: Transaction, pos: number, open: boolean) =>
  tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, open }).setMeta("addToHistory", false);

/** The toggle around the cursor's summary line, if it's in one. */
function summaryAt(state: EditorState): { toggle: ProseNode; pos: number } | null {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "toggle_summary" || $from.depth < 2) return null;
  return { toggle: $from.node($from.depth - 1), pos: $from.before($from.depth - 1) };
}

/**
 * Keys around toggles. In the title line: Enter goes on in the toggle's
 * content (opening it), Backspace at its start turns the toggle back into
 * plain blocks. Delete at the end of the block above a toggle steps into its
 * title. ProseMirror's own joining would merge the title into the block above
 * and lose the toggle's content. Called by the editor from a capturing keydown
 * listener: Crepe's plugins take Backspace before ours could.
 */
export function toggleKeydown(view: EditorView, e: KeyboardEvent): boolean {
  if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "Delete" && deleteIntoToggle(view)) {
    e.preventDefault();
    return true;
  }
  const at = summaryAt(view.state);
  if (!at) return false;
  const { $from, empty } = view.state.selection;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const { schema } = view.state;
    const tr = view.state.tr;
    if (!empty) tr.deleteSelection();
    // Text after the cursor moves down into a new first line of the content.
    const summaryPos = at.pos + 1;
    const cut = tr.selection.from;
    const end = summaryPos + tr.doc.nodeAt(summaryPos)!.nodeSize - 1;
    const after = tr.doc.textBetween(cut, end);
    if (cut < end) tr.delete(cut, end);
    const insertAt = summaryPos + tr.doc.nodeAt(summaryPos)!.nodeSize;
    const next = tr.doc.nodeAt(insertAt);
    // An empty first line is already there (a new toggle): go into it.
    if (!(next?.type.name === "paragraph" && next.content.size === 0 && !after)) {
      tr.insert(insertAt, schema.nodes.paragraph.create(null, after ? schema.text(after) : null));
    }
    setOpenAttr(tr, at.pos, true);
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  if (e.key === "Backspace" && empty && $from.parentOffset === 0) {
    e.preventDefault();
    view.dispatch(unwrapToggle(view.state.tr, at.pos, view.state.schema).scrollIntoView());
    return true;
  }
  return false;
}

/** Delete at the end of a textblock right above a toggle: go to the start of its title instead of merging. */
function deleteIntoToggle(view: EditorView): boolean {
  const { $from, empty } = view.state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size) return false;
  const after = $from.after();
  if (view.state.doc.resolve(after).nodeAfter?.type.name !== "toggle") return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after + 2)));
  return true;
}

const setOpenAttr = (tr: Transaction, pos: number, open: boolean) => tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)!.attrs, open });

/** The toggle's title as a paragraph, then its content: what "Backspace" and "turn into" leave when the toggle goes. */
export function toggleToBlocks(toggle: ProseNode, schema: Schema): ProseNode[] {
  const title = toggle.firstChild!;
  const blocks: ProseNode[] = [schema.nodes.paragraph.create(null, title.content)];
  toggle.content.forEach((child, _offset, i) => {
    if (i > 0) blocks.push(child);
  });
  return blocks;
}

function unwrapToggle(tr: Transaction, pos: number, schema: Schema): Transaction {
  const toggle = tr.doc.nodeAt(pos)!;
  tr = tr.replaceWith(pos, pos + toggle.nodeSize, Fragment.from(toggleToBlocks(toggle, schema)));
  return tr.setSelection(TextSelection.create(tr.doc, pos + 1));
}

/** A new toggle (open) with `title`, and an empty line in it unless content is given. */
export function createToggle(schema: Schema, title: Fragment | null, content: ProseNode[] = []): ProseNode {
  const { toggle, toggle_summary: summary, paragraph } = schema.nodes;
  const text = title ? title.textBetween(0, title.size, " ") : "";
  return toggle.create({ open: true }, [summary.create(null, text ? schema.text(text) : null), ...(content.length ? content : [paragraph.create()])]);
}

/** Make the empty paragraph at the cursor a toggle (the "/" menu). */
export function insertToggle(view: EditorView) {
  const { state } = view;
  const { $from } = state.selection;
  const block = $from.node($from.depth);
  const start = $from.before($from.depth);
  const node = createToggle(state.schema, block.isTextblock ? block.content : null);
  const tr = state.tr.replaceWith(start, start + block.nodeSize, node);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 2)).scrollIntoView());
  view.focus();
}

export const toggle = [remarkToggle, toggleSummarySchema, toggleSchema, toggleView].flat();
