import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** CodeMirror theme driven by the app's CSS variables, so it follows light/dark mode. */
const base = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "13px" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--foreground)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--muted-foreground) 8%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#8b5cf6" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#16a34a" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#ea580c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#2563eb" },
  { tag: [t.typeName, t.className, t.namespace], color: "#0891b2" },
  { tag: [t.propertyName, t.attributeName], color: "#be185d" },
  { tag: [t.heading], fontWeight: "600" },
]);

export const codeTheme = [base, syntaxHighlighting(highlight)];
