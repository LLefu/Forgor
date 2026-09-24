/** [[Note title]], [[Folder/Note title]], [[Note title|Alias]], [[Note title#Heading]] */
const WIKI_RE = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;

export function extractWikiLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(WIKI_RE)) out.add(m[1].trim());
  return [...out];
}

/**
 * Resolve a wiki-link target to a note. Matches on full path (without .md)
 * first, then on title (case-insensitive). Returns the note id or null.
 */
export function resolveWikiTarget(target: string, notes: { id: string; path: string; title: string }[]): string | null {
  const t = target.toLowerCase().replace(/\.md$/, "");
  const byPath = notes.find((n) => n.path.toLowerCase().replace(/\.md$/, "") === t);
  if (byPath) return byPath.id;
  const byTitle = notes.find((n) => n.title.toLowerCase() === t);
  return byTitle?.id ?? null;
}
