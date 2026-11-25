import { Fragment, type Node as ProseNode, type Schema } from "@milkdown/kit/prose/model";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { closeHistory } from "@milkdown/kit/prose/history";
import { createToggle, toggleToBlocks } from "./toggle";

/**
 * "Turn into" (the drag handle's menu): change a block's type. What doesn't
 * fit the new type is split off below it, never dropped: a toggle with three
 * paragraphs turned into a heading becomes a heading with three paragraphs
 * under it. One conversion is one undo step.
 */

export type BlockKind = "text" | "h1" | "h2" | "h3" | "quote" | "bullet" | "numbered" | "todo" | "code" | "toggle";

export const BLOCK_KINDS: { kind: BlockKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "h1", label: "Heading 1" },
  { kind: "h2", label: "Heading 2" },
  { kind: "h3", label: "Heading 3" },
  { kind: "bullet", label: "Bullet list" },
  { kind: "numbered", label: "Numbered list" },
  { kind: "todo", label: "Todo" },
  { kind: "toggle", label: "Toggle" },
  { kind: "quote", label: "Quote" },
  { kind: "code", label: "Code" },
];

const TRAILING_MARKER = /\s*\^t-([a-z0-9]+)\s*$/;

export interface Block {
  node: ProseNode;
  pos: number;
}

/** What this block is now, or null when it can't be turned into anything (an image, a table…). */
export function kindOf(block: Block, state: EditorState): BlockKind | null {
  const { node } = block;
  switch (node.type.name) {
    case "paragraph":
      return "text";
    case "heading":
      return node.attrs.level <= 3 ? (`h${node.attrs.level}` as BlockKind) : "text";
    case "code_block":
      return "code";
    case "blockquote":
      return "quote";
    case "toggle":
      return "toggle";
    case "list_item": {
      if (node.attrs.checked != null) return "todo";
      const list = state.doc.resolve(block.pos).parent;
      return list.type.name === "ordered_list" ? "numbered" : "bullet";
    }
    default:
      return null;
  }
}

/** The kinds this block can become (not what it already is; code only from plain text). */
export function targetsFor(block: Block, state: EditorState): BlockKind[] {
  const current = kindOf(block, state);
  if (!current) return [];
  const plain = blocksOf(block.node, state.schema).every((b) => b.isTextblock && isPlain(b));
  return BLOCK_KINDS.map((k) => k.kind).filter((k) => k !== current && (k !== "code" || plain));
}

/** Text only: no images or other things inside that a code block would lose. */
function isPlain(b: ProseNode) {
  let plain = true;
  b.descendants((n) => {
    if (!n.isText && n.type.name !== "hardbreak") plain = false;
  });
  return plain;
}

/** The block's content as a run of plain blocks (the first is what changes type). */
function blocksOf(node: ProseNode, schema: Schema): ProseNode[] {
  switch (node.type.name) {
    case "code_block":
      return node.textContent
        .replace(/\n+$/, "")
        .split("\n")
        .map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
    case "toggle":
      return toggleToBlocks(node, schema);
    case "paragraph":
    case "heading":
      return [node];
    default: {
      const out: ProseNode[] = [];
      node.forEach((child) => out.push(child));
      return out;
    }
  }
}

function textblock(schema: Schema, kind: BlockKind, first: ProseNode): ProseNode[] {
  const type = kind === "text" ? schema.nodes.paragraph : kind === "code" ? schema.nodes.code_block : schema.nodes.heading;
  const attrs = kind.startsWith("h") ? { level: Number(kind.slice(1)) } : null;
  if (!first.isTextblock) return [type.create(attrs), first];
  if (first.type.name === "code_block" || kind === "code") return [type.create(attrs, first.textContent ? schema.text(first.textContent) : null)];
  return [type.create(attrs, first.content)];
}

/** The new block(s) for `kind` from the old content. */
function build(schema: Schema, kind: BlockKind, blocks: ProseNode[]): ProseNode[] {
  const n = schema.nodes;
  const content = blocks.length ? blocks : [n.paragraph.create()];
  switch (kind) {
    case "quote":
      return [n.blockquote.create(null, content)];
    case "bullet":
      return [n.bullet_list.create(null, n.list_item.create({ listType: "bullet", checked: null }, content))];
    case "todo":
      return [n.bullet_list.create(null, n.list_item.create({ listType: "bullet", checked: false }, content))];
    case "numbered":
      return [n.ordered_list.create(null, n.list_item.create({ listType: "ordered", checked: null }, content))];
    case "toggle": {
      const [first, ...rest] = content;
      return first.isTextblock ? [createToggle(schema, first.content, rest)] : [createToggle(schema, null, content)];
    }
    case "code": {
      const text = content.map((b) => b.textContent).join("\n");
      return [n.code_block.create(null, text ? schema.text(text) : null)];
    }
    default:
      return [...textblock(schema, kind, content[0]), ...content.slice(1)];
  }
}

/** The todo a todo line is linked to (its `^t-` marker), if any. */
export function linkedTodo(block: Block): string | null {
  if (block.node.type.name !== "list_item" || block.node.attrs.checked == null) return null;
  return TRAILING_MARKER.exec(block.node.firstChild?.textContent ?? "")?.[1] ?? null;
}

function withoutMarker(para: ProseNode): ProseNode {
  const m = TRAILING_MARKER.exec(para.textContent);
  return m ? para.cut(0, para.content.size - m[0].length) : para;
}

/**
 * Turn the block into `kind`. A todo line that stops being one loses its
 * marker (the todo itself is the caller's business). Returns the transaction,
 * or null when nothing changes.
 */
export function turnInto(state: EditorState, block: Block, kind: BlockKind): Transaction | null {
  const current = kindOf(block, state);
  if (!current || current === kind) return null;
  const { schema } = state;
  // Its own undo step, also right after another change.
  const tr = closeHistory(state.tr);
  const { node, pos } = block;

  if (node.type.name === "list_item") {
    const $pos = state.doc.resolve(pos);
    const list = $pos.parent;
    const listPos = $pos.before();
    // Bullet ↔ todo in a bullet list: only the checkbox changes.
    if (list.type.name === "bullet_list" && (kind === "todo" || kind === "bullet")) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: kind === "todo" ? false : null });
      if (kind === "bullet" && node.firstChild && node.firstChild.isTextblock) {
        const para = node.firstChild;
        tr.replaceWith(pos + 1, pos + 1 + para.nodeSize, withoutMarker(para));
      }
      return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
    }
    let blocks = blocksOf(node, schema);
    if (kind !== "todo" && blocks[0]?.isTextblock) blocks = [withoutMarker(blocks[0]), ...blocks.slice(1)];
    const index = $pos.index();
    const before: ProseNode[] = [];
    const after: ProseNode[] = [];
    list.forEach((item, _offset, i) => (i < index ? before : i > index ? after : []).push(item));
    const replacement = [
      ...(before.length ? [list.copy(Fragment.from(before))] : []),
      ...build(schema, kind, blocks),
      ...(after.length ? [list.copy(Fragment.from(after))] : []),
    ];
    tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
    const start = listPos + (before.length ? replacement[0].nodeSize : 0);
    return tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
  }

  tr.replaceWith(pos, pos + node.nodeSize, build(schema, kind, blocksOf(node, schema)));
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
}
