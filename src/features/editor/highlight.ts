import { commandsCtx } from "@milkdown/kit/core";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { markRule } from "@milkdown/kit/prose";
import { $command, $inputRule, $markSchema, $remark } from "@milkdown/kit/utils";
import type { Ctx } from "@milkdown/kit/ctx";
import type { RemarkPluginRaw } from "@milkdown/kit/transformer";

/**
 * Highlight: `==text==` in markdown (like Obsidian and Typora), a <mark> in
 * the editor in the theme's color. Markdown has no such syntax, so a remark
 * step turns `==…==` in text into "highlight" nodes when reading, and writes
 * them back the same way.
 */

type MdNode = { type: string; value?: string; children?: MdNode[] };

/** "==" that isn't part of "===" (a == b == c in prose still pairs up, as in Obsidian). */
const DELIM = /(?<!=)==(?!=)/;
const SKIP = new Set(["inlineCode", "code", "html", "math", "inlineMath"]);
const OPEN = Symbol("==");

function highlightChildren(children: MdNode[]): MdNode[] {
  for (const c of children) if (c.children && !SKIP.has(c.type)) c.children = highlightChildren(c.children);
  if (!children.some((c) => c.type === "text" && DELIM.test(c.value ?? ""))) return children;

  // Split text at the delimiters, then pair them left to right.
  const tokens: (MdNode | typeof OPEN)[] = [];
  for (const c of children) {
    if (c.type !== "text" || !DELIM.test(c.value ?? "")) {
      tokens.push(c);
      continue;
    }
    c.value!.split(DELIM).forEach((piece, i) => {
      if (i > 0) tokens.push(OPEN);
      if (piece) tokens.push({ type: "text", value: piece });
    });
  }
  const out: MdNode[] = [];
  let open = -1; // index in `out` where the open delimiter stands
  for (const t of tokens) {
    if (t !== OPEN) {
      out.push(t);
      continue;
    }
    if (open < 0) {
      open = out.length;
      out.push({ type: "text", value: "==" }); // stays text if it never closes
      continue;
    }
    const inner = out.splice(open + 1);
    if (inner.length) out.splice(open, 1, { type: "highlight", children: inner });
    else out.push({ type: "text", value: "==" });
    open = -1;
  }
  // Join neighbouring text nodes again.
  return out.reduce<MdNode[]>((acc, n) => {
    const last = acc[acc.length - 1];
    if (n.type === "text" && last?.type === "text") last.value = (last.value ?? "") + n.value;
    else acc.push(n);
    return acc;
  }, []);
}

/** Exported for tests: the remark step on a tree. */
export function highlightTree(tree: MdNode) {
  if (tree.children) tree.children = highlightChildren(tree.children);
}

type Handler = (node: MdNode, parent: unknown, state: { containerPhrasing: (n: MdNode, info: object) => string }, info: object) => string;

export const remarkHighlight = $remark("remarkHighlight", () =>
  // unified calls plugins with the processor as `this`.
  function (this: { data(): Record<string, unknown> }) {
    const data = this.data();
    const handler: Handler = (node, _parent, state, info) => `==${state.containerPhrasing(node, { ...info, before: "=", after: "=" })}==`;
    ((data.toMarkdownExtensions ??= []) as object[]).push({ handlers: { highlight: handler } });
    return (tree: MdNode) => highlightTree(tree);
  } as unknown as RemarkPluginRaw<unknown>,
);

export const highlightSchema = $markSchema("highlight", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", { class: "note-highlight" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "highlight",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "highlight",
    runner: (state, mark) => {
      state.withMark(mark, "highlight");
    },
  },
}));

export const toggleHighlightCommand = $command("ToggleHighlight", (ctx) => () => toggleMark(highlightSchema.type(ctx)));

/** Typing `==text==` highlights it. */
export const highlightInputRule = $inputRule((ctx) => markRule(/(?<![\w=])==([^=\s](?:[^=]*[^=\s])?)==$/, highlightSchema.type(ctx)));

export const highlight = [remarkHighlight, highlightSchema, toggleHighlightCommand, highlightInputRule].flat();

export const runToggleHighlight = (ctx: Ctx) => ctx.get(commandsCtx).call(toggleHighlightCommand.key);
