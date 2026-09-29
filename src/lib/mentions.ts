/**
 * "@" links to notes, todos and folders. Stored as ordinary markdown links
 * with an id-based URL, so they survive renames and moves:
 *
 *   [Planning](forgor://note/<id>)      link to a note
 *   [Planning](forgor://embed/<id>)     the whole note shown inline ("Show entire note")
 *   [Call Jan](forgor://todo/<id>)
 *   [Acme](forgor://folder/<id>)
 *
 * The link text is the target's name; renaming the target rewrites it in every note.
 */
export type MentionKind = "note" | "embed" | "todo" | "folder";

const PREFIX = "forgor://";

export const mentionHref = (kind: MentionKind, id: string) => `${PREFIX}${kind}/${id}`;

export function parseMentionHref(href: string | null | undefined): { kind: MentionKind; id: string } | null {
  const m = /^forgor:\/\/(note|embed|todo|folder)\/([A-Za-z0-9_-]+)$/.exec(href ?? "");
  return m ? { kind: m[1] as MentionKind, id: m[2] } : null;
}

/** Link text: `\`, `[` and `]` must be escaped inside [ ]. */
export function escapeLinkText(text: string): string {
  return text.replace(/[\\[\]]/g, (c) => "\\" + c);
}

// [text](forgor://kind/id) — text may contain escaped characters.
const LINK_RE = /\[((?:\\.|[^\]\\\n])*)\]\(forgor:\/\/(note|embed|todo|folder)\/([A-Za-z0-9_-]+)\)/g;

export function extractMentions(md: string): { kind: MentionKind; id: string }[] {
  const seen = new Set<string>();
  const out: { kind: MentionKind; id: string }[] = [];
  for (const m of md.matchAll(LINK_RE)) {
    const key = `${m[2]}/${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: m[2] as MentionKind, id: m[3] });
  }
  return out;
}

/**
 * Set the link text of every mention of `id` (for notes: links and embeds) to
 * `title`. Returns null when nothing changed.
 */
export function renameMentions(md: string, kinds: MentionKind[], id: string, title: string): string | null {
  let changed = false;
  const out = md.replace(LINK_RE, (all, _text: string, kind: MentionKind, target: string) => {
    if (target !== id || !kinds.includes(kind)) return all;
    const next = `[${escapeLinkText(title)}](${mentionHref(kind, target)})`;
    if (next !== all) changed = true;
    return next;
  });
  return changed ? out : null;
}
