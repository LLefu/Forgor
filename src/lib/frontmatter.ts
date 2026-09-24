import YAML from "yaml";

export interface ParsedNote {
  /** Frontmatter object (may contain user fields we preserve untouched). */
  data: Record<string, unknown>;
  body: string;
}

/** Frontmatter block plus the (up to one) blank line we write after it. */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n){0,2}/;

export function parseNote(text: string): ParsedNote {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text };
  let data: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // Malformed frontmatter: treat the whole file as body so we never lose content.
    return { data: {}, body: text };
  }
  return { data, body: text.slice(m[0].length) };
}

export function stringifyNote(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return body;
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, "")}`;
}
