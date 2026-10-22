import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Keys = typeof import("./keys");
type Shortcuts = typeof import("@/app/shortcuts");

/** keys.ts reads the platform once, when loaded: load it fresh as that platform. */
async function loadAs(platform: string): Promise<Keys & Shortcuts> {
  vi.resetModules();
  vi.stubGlobal("navigator", { platform, userAgent: "" });
  return { ...(await import("./keys")), ...(await import("@/app/shortcuts")) };
}

afterAll(() => {
  vi.unstubAllGlobals();
});

const key = (k: string, code: string, mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({
  key: k,
  code,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("keyboard shortcuts (Windows/Linux: Mod = Ctrl)", () => {
  let k: Keys & Shortcuts;
  beforeAll(async () => {
    k = await loadAs("Win32");
  });
  it("runs as Windows here", () => expect(k.isMac).toBe(false));

  it("matches combos, also when Shift or Alt change the typed character", () => {
    expect(k.matches(key("n", "KeyN", { ctrl: true }), "Mod+N")).toBe(true);
    expect(k.matches(key("N", "KeyN", { ctrl: true, shift: true }), "Mod+Shift+N")).toBe(true);
    expect(k.matches(key("N", "KeyN", { ctrl: true, shift: true }), "Mod+N")).toBe(false);
    expect(k.matches(key("?", "Slash", { ctrl: true, shift: true }), "Mod+Shift+/")).toBe(true);
    expect(k.matches(key("/", "Slash", { ctrl: true }), "Mod+/")).toBe(true);
    expect(k.matches(key("˙", "KeyH", { ctrl: true, alt: true }), "Mod+Alt+H")).toBe(true);
    expect(k.matches(key("Tab", "Tab", { ctrl: true }), "Ctrl+Tab")).toBe(true); // Ctrl = Mod here
    expect(k.matches(key("ArrowLeft", "ArrowLeft", { alt: true }), "Alt+ArrowLeft")).toBe(true);
    expect(k.matches(key("F2", "F2"), "F2")).toBe(true);
  });

  it("uses the typed letter on other layouts (AZERTY's A is on Q's key)", () => {
    expect(k.eventKey({ key: "a", code: "KeyQ" })).toBe("A");
  });

  it("turns a key press into a combo, ignoring lone modifiers", () => {
    expect(k.comboFromEvent(key("k", "KeyK", { ctrl: true, shift: true }))).toBe("Mod+Shift+K");
    expect(k.comboFromEvent(key("Control", "ControlLeft", { ctrl: true }))).toBeNull();
    expect(k.comboFromEvent(key(" ", "Space", { ctrl: true, alt: true }))).toBe("Mod+Alt+Space");
  });

  it("normalizes combos so they compare", () => {
    expect(k.normalizeCombo("shift+mod+a")).toBe("Mod+Shift+A");
    expect(k.normalizeCombo("Ctrl+Tab")).toBe("Mod+Tab");
  });

  it("only allows combos with Mod/Ctrl/Alt or an F-key, and not the system's", () => {
    expect(k.isUsableCombo("Shift+A")).toBe(false);
    expect(k.isUsableCombo("F2")).toBe(true);
    expect(k.isUsableCombo("Alt+ArrowLeft")).toBe(true);
    expect(k.reservedReason("Mod+C")).toMatch(/copy/);
    expect(k.reservedReason("Mod+N")).toBeNull();
  });

  it("labels combos", () => {
    expect(k.shortcutLabel("Mod+Shift+A")).toBe("Ctrl+Shift+A");
    expect(k.shortcutLabel("Alt+ArrowLeft")).toBe("Alt+←");
  });

  it("converts the global shortcut to and from Tauri's format", () => {
    expect(k.fromGlobalCombo("Control+Alt+Space")).toBe("Mod+Alt+Space");
    expect(k.fromGlobalCombo("CommandOrControl+Shift+Space")).toBe("Mod+Shift+Space");
    expect(k.toGlobalCombo("Mod+Shift+K")).toBe("CommandOrControl+Shift+K");
    expect(k.toGlobalCombo("Mod+ArrowLeft")).toBeNull();
  });

  it("the app's defaults don't clash with each other or with the fixed ones", () => {
    const seen = new Map<string, string>();
    for (const s of k.APP_SHORTCUTS) {
      for (const combo of s.keys) {
        const c = k.normalizeCombo(combo);
        expect(seen.get(c), `${combo} of ${s.label}`).toBeUndefined();
        expect(k.reservedReason(combo), combo).toBeNull();
        seen.set(c, s.label);
      }
    }
    for (const f of k.FIXED_SHORTCUTS) for (const combo of f.combos) expect(seen.has(k.normalizeCombo(combo)), combo).toBe(false);
  });

  it("tells who uses a combo, with the user's changes", () => {
    expect(k.usedBy("Mod+N", k.APP_SHORTCUTS, {})).toBe("New note");
    expect(k.usedBy("Mod+N", k.APP_SHORTCUTS, { "new-note": ["Mod+Alt+N"] })).toBeNull();
    expect(k.usedBy("Mod+3", k.APP_SHORTCUTS, {})).toMatch(/tab/);
    expect(k.keysOf({ id: "x", keys: ["Mod+J"] }, { x: [] })).toEqual([]);
  });
});

describe("keyboard shortcuts (macOS: Mod = ⌘, Ctrl = ⌃)", () => {
  let k: Keys & Shortcuts;
  beforeAll(async () => {
    k = await loadAs("MacIntel");
  });
  it("tells ⌘ and ⌃ apart", () => {
    expect(k.matches(key("n", "KeyN", { meta: true }), "Mod+N")).toBe(true);
    expect(k.matches(key("n", "KeyN", { ctrl: true }), "Mod+N")).toBe(false);
    expect(k.matches(key("Tab", "Tab", { ctrl: true }), "Ctrl+Tab")).toBe(true);
    expect(k.matches(key("Tab", "Tab", { meta: true }), "Ctrl+Tab")).toBe(false);
    expect(k.comboFromEvent(key("Tab", "Tab", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+Tab");
  });
  it("labels with symbols", () => {
    expect(k.shortcutLabel("Mod+Shift+A")).toBe("⇧⌘A");
    expect(k.shortcutLabel("Ctrl+Tab")).toBe("⌃⇥");
    expect(k.shortcutLabel("Mod+\\")).toBe("⌘\\");
  });
  it("reserves macOS's own combos, and converts the global shortcut", () => {
    expect(k.reservedReason("Mod+Q")).toMatch(/system/);
    expect(k.fromGlobalCombo("CommandOrControl+Shift+Space")).toBe("Mod+Shift+Space");
    expect(k.fromGlobalCombo("Control+Alt+Space")).toBe("Ctrl+Alt+Space");
  });
});
