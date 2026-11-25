import { describe, expect, it, vi } from "vitest";
import { listItems } from "./items";
import type { Plugin, PluginItem } from "./types";

const Icon = () => null;
const plugin = (id: string, items?: () => Promise<PluginItem[]>): Plugin =>
  ({ id, name: id.toUpperCase(), description: "", version: "1.0.0", author: "", icon: Icon, ...(items ? { items: { kind: `${id} thing`, items } } : {}) }) as Plugin;
const open = () => {};

describe("items from plugins", () => {
  it("combines the sources, says where each item comes from", async () => {
    const r = await listItems([
      plugin("a", async () => [{ id: "1", title: "One", dueDate: "2026-12-01", estimateMin: 30, open }]),
      plugin("b", async () => [{ id: "2", title: "Two", open }]),
      plugin("c"), // no items
    ]);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => [i.source, i.sourceName, i.kind, i.id])).toEqual([
      ["a", "A", "a thing", "1"],
      ["b", "B", "b thing", "2"],
    ]);
    expect(r.items[0]).toMatchObject({ dueDate: "2026-12-01", estimateMin: 30 });
  });

  it("a failing source is named in errors, the others still come through", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await listItems([
      plugin("a", async () => {
        throw new Error("offline");
      }),
      plugin("b", async () => [{ id: "2", title: "Two", open }]),
      plugin("c", async () => "nope" as unknown as PluginItem[]),
    ]);
    expect(r.items.map((i) => i.id)).toEqual(["2"]);
    expect(r.errors).toEqual([
      { source: "a", sourceName: "A", message: "offline" },
      { source: "c", sourceName: "C", message: "items() didn't return a list" },
    ]);
    warn.mockRestore();
  });

  it("drops wrongly shaped items instead of handing them on", async () => {
    const r = await listItems([
      plugin("a", async () =>
        [
          { id: "ok", title: "Fine", open },
          { id: 3, title: "Number id", open },
          { id: "x", title: "No open" },
          { id: "y", title: "Bad estimate", estimateMin: "1h", open },
          null,
        ] as unknown as PluginItem[],
      ),
    ]);
    expect(r.items.map((i) => i.id)).toEqual(["ok"]);
  });
});
