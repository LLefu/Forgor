import { describe, expect, it } from "vitest";
import { extractMentions, mentionHref, parseMentionHref, renameMentions } from "./mentions";
import { hexToRgb, hsvToRgb, normalizeHex, readableOn, rgbToHex, rgbToHsv } from "./colors";
import { colorHex } from "./folderColors";
import { getAccent } from "./accents";

describe("mentions", () => {
  it("round-trips hrefs", () => {
    expect(parseMentionHref(mentionHref("todo", "abc123"))).toEqual({ kind: "todo", id: "abc123" });
    expect(parseMentionHref("https://x.com")).toBeNull();
  });
  it("extracts unique targets, including escaped link text", () => {
    const md = String.raw`[A \[b\]](forgor://note/n1) and [A](forgor://note/n1), [T](forgor://todo/t1) [x](https://e.com)`;
    expect(extractMentions(md)).toEqual([
      { kind: "note", id: "n1" },
      { kind: "todo", id: "t1" },
    ]);
  });
  it("renames only the given kinds and id", () => {
    const md = "[Old](forgor://note/n1) [Old](forgor://embed/n1) [Old](forgor://note/n2) [Old](forgor://todo/n1)";
    expect(renameMentions(md, ["note", "embed"], "n1", "New")).toBe(
      "[New](forgor://note/n1) [New](forgor://embed/n1) [Old](forgor://note/n2) [Old](forgor://todo/n1)",
    );
    expect(renameMentions(md, ["folder"], "n1", "New")).toBeNull();
  });
});

describe("colors", () => {
  it("converts between hex, rgb and hsv", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("12345")).toBeNull();
    expect(rgbToHex(...hexToRgb("#123abc"))).toBe("#123abc");
    const [h, s, v] = rgbToHsv(18, 58, 188);
    expect(rgbToHex(...hsvToRgb(h, s, v))).toBe("#123abc");
    expect(rgbToHex(...hsvToRgb(0, 1, 1))).toBe("#ff0000");
  });
  it("custom hex colors work as folder and highlight colors", () => {
    expect(colorHex("#123abc")).toBe("#123abc");
    expect(colorHex("gray")).toBe("#71717a"); // retired preset still resolves
    expect(getAccent("#fde047")).toMatchObject({ light: "#fde047", dark: "#fde047", lightForeground: "#18181b" });
    expect(readableOn("#1e3a8a")).toBe("#ffffff");
  });
});
