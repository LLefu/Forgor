import { describe, expect, it } from "vitest";
import { highlightTree } from "./highlight";
import { toggleTree } from "./toggle";

type N = { type: string; value?: string; summary?: string; children?: N[] };
const text = (value: string): N => ({ type: "text", value });
const para = (...children: N[]): N => ({ type: "paragraph", children });
const html = (value: string): N => ({ type: "html", value });

describe("==highlight==", () => {
  const run = (children: N[]) => {
    const tree: N = { type: "root", children: [para(...children)] };
    highlightTree(tree);
    return tree.children![0].children;
  };

  it("turns ==text== into a highlight, also around other marks", () => {
    expect(run([text("a ==b== c")])).toEqual([text("a "), { type: "highlight", children: [text("b")] }, text(" c")]);
    expect(run([text("x ==a "), { type: "strong", children: [text("bold")] }, text(" z== y")])).toEqual([
      text("x "),
      { type: "highlight", children: [text("a "), { type: "strong", children: [text("bold")] }, text(" z")] },
      text(" y"),
    ]);
  });

  it("leaves unpaired ==, === and code alone", () => {
    expect(run([text("a == b")])).toEqual([text("a == b")]);
    expect(run([text("a === b === c")])).toEqual([text("a === b === c")]);
    expect(run([{ type: "inlineCode", value: "==x==" }])).toEqual([{ type: "inlineCode", value: "==x==" }]);
    expect(run([text("====")])).toEqual([text("====")]);
  });
});

describe("<details> toggles", () => {
  const run = (children: N[]) => {
    const tree: N = { type: "root", children };
    toggleTree(tree);
    return tree.children;
  };

  it("reads <details> … </details> with its summary and content, also nested", () => {
    expect(run([html("<details>\n<summary>Notes &amp; more</summary>"), para(text("inside")), html("</details>"), para(text("after"))])).toEqual([
      { type: "toggle", summary: "Notes & more", children: [para(text("inside"))] },
      para(text("after")),
    ]);
    expect(run([html("<details>\n<summary>Outer</summary>"), html("<details>\n<summary>Inner</summary>"), para(text("x")), html("</details>"), html("</details>")])).toEqual([
      { type: "toggle", summary: "Outer", children: [{ type: "toggle", summary: "Inner", children: [para(text("x"))] }] },
    ]);
  });

  it("also when Milkdown has put the html blocks in paragraphs of their own", () => {
    expect(run([para(html("<details>\n<summary>S</summary>")), para(text("x")), para(html("</details>"))])).toEqual([{ type: "toggle", summary: "S", children: [para(text("x"))] }]);
  });

  it("an all-in-one block works, and one that never closes stays as it was", () => {
    expect(run([html("<details><summary>T</summary>\nbody\n</details>")])).toEqual([{ type: "toggle", summary: "T", children: [para(text("body"))] }]);
    expect(run([html("<details>\n<summary>Open</summary>"), para(text("x"))])).toEqual([html("<details>\n<summary>Open</summary>"), para(text("x"))]);
  });
});
