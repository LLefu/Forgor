import { describe, expect, it } from "vitest";
import conf from "../../src-tauri/tauri.conf.json";

/** Settings that only matter on one OS, so they're easy to break without noticing. */
describe("tauri.conf.json", () => {
  it("lets the fs scope reach dot-folders like .trash on macOS", () => {
    // Defaults to true on Unix: "**" would then NOT match "<vault>/.trash/...",
    // and moving notes to the trash fails on macOS only.
    expect((conf.plugins as { fs?: { requireLiteralLeadingDot?: boolean } }).fs?.requireLiteralLeadingDot).toBe(false);
  });

  it("disables native drag-drop on every window (it swallows HTML5 drags)", () => {
    for (const w of conf.app.windows) expect(w.dragDropEnabled).toBe(false);
  });
});
