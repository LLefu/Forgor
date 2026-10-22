import { describe, expect, it } from "vitest";
import { sanitizeDefinition } from "./validate";
import { errorMessage, pluginIdFromStack, REJECTION_LIMIT, resetRejections, tooManyRejections } from "./faults";

const C = () => null;

describe("what a plugin returns is checked when it loads", () => {
  it("keeps a good definition as it is", () => {
    const def = {
      icon: C,
      sidebar: C,
      pages: { main: { useTab: () => ({ label: "x", icon: C }), component: C } },
      panels: { p: C },
      today: { cards: C, section: C },
      hosts: [C],
      shortcuts: [{ id: "a", label: "A", keys: ["Mod+Alt+A"], run() {} }],
      notifications: [{ kind: "k", label: "K", settings: C }],
      chat: { kind: "Thing", items: async () => [] },
      remoteQueries: ["q"],
      start: () => () => {},
      somethingNewer: { fromANewerForgor: true },
    };
    const r = sanitizeDefinition(def);
    expect(r.warnings).toEqual([]);
    expect(r.definition).toEqual(def);
  });

  it("drops what has the wrong shape and says so, keeping the rest", () => {
    const r = sanitizeDefinition({
      shortcuts: "nope",
      sidebar: "not a component",
      start: 42,
      hosts: [C, "x"],
      pages: { ok: { useTab: () => ({}), component: C }, bad: { component: C } },
      today: { cards: C, section: 3 },
      chat: { kind: "x" },
      remoteQueries: [1],
    });
    const d = r.definition as Record<string, unknown>;
    expect(d.shortcuts).toBeUndefined();
    expect(d.sidebar).toBeUndefined();
    expect(d.start).toBeUndefined();
    expect(d.hosts).toEqual([C]);
    expect(Object.keys(d.pages as object)).toEqual(["ok"]);
    expect(d.today).toEqual({ cards: C });
    expect(d.chat).toBeUndefined();
    expect(d.remoteQueries).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThanOrEqual(8);
    expect(r.warnings.join(" ")).toContain("“shortcuts” was ignored");
  });

  it("shortcuts: bad entries and keys are dropped one by one", () => {
    const r = sanitizeDefinition({
      shortcuts: [
        { id: "a", label: "A", keys: "Mod+Alt+9", run() {} }, // keys must be a list: kept without keys
        { id: "b", label: "B", run() {} }, // fine, no keys
        { id: "a", label: "again", run() {} }, // id twice
        { id: "c", run() {} }, // no label
        "x",
      ],
    });
    const list = (r.definition as { shortcuts: { id: string; keys?: string[] }[] }).shortcuts;
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
    expect(list[0].keys).toEqual([]);
    expect(r.warnings).toHaveLength(4);
  });

  it("something that isn't an object loads as an empty plugin, with a warning", () => {
    for (const bad of [undefined, null, "x", 5, [C]]) {
      const r = sanitizeDefinition(bad);
      expect(r.definition).toEqual({});
      expect(r.warnings).toHaveLength(1);
    }
  });
});

describe("which plugin caused an error", () => {
  it("reads it from the stack, in Chromium's and WebKit's format", () => {
    const chromium = "Error: boom\n    at Object.run (forgor-plugin://hello-world/main.js:12:9)\n    at HTMLButtonElement.onClick (http://localhost:1430/src/x.tsx:1:1)";
    const webkit = "run@forgor-plugin://hello-world/main.js:12:9\nonClick@http://localhost:1430/src/x.tsx:1:1";
    expect(pluginIdFromStack(chromium)).toBe("hello-world");
    expect(pluginIdFromStack(webkit)).toBe("hello-world");
    expect(pluginIdFromStack("Error: x\n    at foo (http://localhost:1430/src/app.tsx:1:1)")).toBeNull();
    expect(pluginIdFromStack(undefined)).toBeNull();
    expect(pluginIdFromStack({})).toBeNull();
  });

  it("the innermost plugin frame is the culprit", () => {
    expect(pluginIdFromStack("at a (forgor-plugin://inner/main.js:1:1)\nat b (forgor-plugin://outer/main.js:2:2)")).toBe("inner");
  });

  it("a short message from anything that was thrown", () => {
    expect(errorMessage(new Error("it broke"))).toBe("it broke");
    expect(errorMessage("plain text")).toBe("plain text");
    expect(errorMessage(undefined)).toBe("Unknown error");
    expect(errorMessage(new Error("x".repeat(500))).length).toBeLessThanOrEqual(200);
    expect(errorMessage(new Error("two\n  lines"))).toBe("two lines");
  });

  it("one rejected promise is a notice; five within a minute is too many", () => {
    resetRejections();
    for (let i = 1; i < REJECTION_LIMIT; i++) expect(tooManyRejections("p", 1000 + i)).toBe(false);
    expect(tooManyRejections("p", 2000)).toBe(true);
    expect(tooManyRejections("other", 2000)).toBe(false);
    // old ones fall out of the window
    resetRejections();
    for (let i = 0; i < REJECTION_LIMIT; i++) expect(tooManyRejections("q", i * 20_000)).toBe(false); // 80 s apart in all: never 5 within 60 s
  });
});
