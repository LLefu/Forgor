/**
 * Parser for CHANGELOG.md (also used by scripts/release.mjs and the release
 * workflow, so keep the format simple):
 *
 *   ## 0.2.0 (2026-10-01)      or   ## Unreleased
 *   ### New                          (optional group heading)
 *   - an entry
 */
export interface ChangelogGroup {
  title: string | null;
  items: string[];
}

export interface ChangelogVersion {
  version: string; // "0.2.0" or "Unreleased"
  date: string | null;
  groups: ChangelogGroup[];
}

const VERSION_RE = /^##\s+(\S+)(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/;

export function parseChangelog(md: string): ChangelogVersion[] {
  const out: ChangelogVersion[] = [];
  let current: ChangelogVersion | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const v = VERSION_RE.exec(line);
    if (v) {
      current = { version: v[1], date: v[2] ?? null, groups: [] };
      out.push(current);
      continue;
    }
    if (!current) continue;
    const g = /^###\s+(.+)$/.exec(line);
    if (g) {
      current.groups.push({ title: g[1].trim(), items: [] });
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!current.groups.length) current.groups.push({ title: null, items: [] });
      current.groups[current.groups.length - 1].items.push(item[1].trim());
    }
  }
  // Drop empty groups/versions (e.g. a fresh, empty "Unreleased").
  return out
    .map((v) => ({ ...v, groups: v.groups.filter((g) => g.items.length) }))
    .filter((v) => v.groups.length);
}

/** Markdown text of one version's section (for release notes). */
export function sectionMarkdown(v: ChangelogVersion): string {
  return v.groups.map((g) => [g.title ? `### ${g.title}` : "", ...g.items.map((i) => `- ${i}`)].filter(Boolean).join("\n")).join("\n\n");
}
