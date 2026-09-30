import { describe, expect, it } from "vitest";
import { stepZoom, zoomAction, zoomLabel, ZOOM_LEVELS } from "./zoom";
import { isMac } from "./keys";

const mod = isMac ? { metaKey: true, ctrlKey: false } : { metaKey: false, ctrlKey: true };
const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, code: "", altKey: false, ...mod, ...extra });

describe("zoom", () => {
  it("steps through the levels and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.2, 1)).toBe(1.25); // off-list values snap to the next level
    expect(stepZoom(1.2, -1)).toBe(1.1);
    expect(ZOOM_LEVELS).toContain(1);
  });

  it("maps Ctrl/⌘ +, -, 0 (and the numpad) to actions", () => {
    expect(zoomAction(key("="))).toBe("in");
    expect(zoomAction(key("+", { shiftKey: true }))).toBe("in");
    expect(zoomAction(key("", { code: "NumpadAdd" }))).toBe("in");
    expect(zoomAction(key("-"))).toBe("out");
    expect(zoomAction(key("0"))).toBe("reset");
    expect(zoomAction({ ...key("="), metaKey: false, ctrlKey: false })).toBeNull();
    expect(zoomAction(key("=", { altKey: true }))).toBeNull();
    expect(zoomAction(key("k"))).toBeNull();
  });

  it("labels as a percentage", () => {
    expect(zoomLabel(0.67)).toBe("67%");
    expect(zoomLabel(1.25)).toBe("125%");
  });
});
