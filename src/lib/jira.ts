/** Jira data as Forgor shows it, and the requests that fetch it (pure; the hooks are in app/jira.ts). */

export type StatusCategory = "new" | "indeterminate" | "done";

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  priority: string | null;
  type: string | null;
  project: { key: string; name: string };
  assignee: string | null;
  reporter: string | null;
  created: string;
  updated: string;
  /** YYYY-MM-DD */
  due: string | null;
  labels: string[];
  /** Atlassian Document Format (only fetched for the detail view). */
  description: AdfNode | null;
  /** Files on the ticket (detail view); images in the description and comments are among them. */
  attachments: JiraAttachment[];
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface JiraComment {
  id: string;
  author: string;
  created: string;
  body: AdfNode | null;
}

/** A board linked to a folder (stored on the folder). */
export interface JiraBoardRef {
  id: number;
  name: string;
  projectKey: string | null;
  projectName: string | null;
}

/** Atlassian Document Format: the rich text of descriptions and comments. */
export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export const LIST_FIELDS = "summary,status,priority,issuetype,project,assignee,reporter,created,updated,duedate,labels";
export const DETAIL_FIELDS = `${LIST_FIELDS},description,attachment`;

/** Open tickets assigned to me, newest change first. */
export const MY_OPEN_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
/** Also the ones done in the last 30 days (the "show done" filter). */
export const MY_RECENT_JQL = "assignee = currentUser() AND (statusCategory != Done OR updated >= -30d) ORDER BY updated DESC";

const enc = encodeURIComponent;

export const paths = {
  /** One page of all boards; the search is done here (`matchBoards`), since Jira's only matches the board name. */
  boards: (startAt: number) => `/rest/agile/1.0/board?maxResults=50&startAt=${startAt}`,
  boardIssues: (boardId: number, withDone: boolean) =>
    `/rest/agile/1.0/board/${boardId}/issue?maxResults=100&fields=${LIST_FIELDS}&jql=${enc(withDone ? MY_RECENT_JQL : MY_OPEN_JQL)}`,
  search: (jql: string, nextPageToken?: string) =>
    `/rest/api/3/search/jql?maxResults=100&fields=${LIST_FIELDS}&jql=${enc(jql)}${nextPageToken ? `&nextPageToken=${enc(nextPageToken)}` : ""}`,
  issue: (key: string) => `/rest/api/3/issue/${enc(key)}?fields=${DETAIL_FIELDS}`,
  comments: (key: string) => `/rest/api/3/issue/${enc(key)}/comment?orderBy=created&maxResults=100`,
};

type Raw = { key: string; fields: Record<string, unknown> };
const name = (v: unknown): string | null => ((v as { name?: string; displayName?: string } | null)?.displayName ?? (v as { name?: string } | null)?.name) || null;

export function toIssue(raw: Raw): JiraIssue {
  const f = raw.fields ?? {};
  const status = f.status as { name?: string; statusCategory?: { key?: string } } | undefined;
  const project = f.project as { key?: string; name?: string } | undefined;
  const category = status?.statusCategory?.key;
  return {
    key: raw.key,
    summary: String(f.summary ?? ""),
    status: status?.name ?? "",
    statusCategory: category === "done" || category === "indeterminate" ? category : "new",
    priority: name(f.priority),
    type: name(f.issuetype),
    project: { key: project?.key ?? raw.key.split("-")[0], name: project?.name ?? "" },
    assignee: name(f.assignee),
    reporter: name(f.reporter),
    created: String(f.created ?? ""),
    updated: String(f.updated ?? ""),
    due: (f.duedate as string | null) ?? null,
    labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
    description: (f.description as AdfNode | null) ?? null,
    attachments: Array.isArray(f.attachment)
      ? (f.attachment as { id: string | number; filename?: string; mimeType?: string; size?: number }[]).map((a) => ({
          id: String(a.id),
          filename: a.filename ?? "",
          mimeType: a.mimeType ?? "",
          size: a.size ?? 0,
        }))
      : [],
  };
}

const MEDIA = new Set(["media", "mediaInline"]);

/**
 * Which attachment each media node in a document shows. ADF only has a
 * media-service id there, not the attachment id, so match by file name (`alt`);
 * images without one take the remaining image attachments in order.
 */
export function mediaAttachments(doc: AdfNode | null, attachments: JiraAttachment[], fallbackInOrder: boolean): Map<AdfNode, JiraAttachment> {
  const nodes: AdfNode[] = [];
  const walk = (n: AdfNode) => {
    if (MEDIA.has(n.type)) nodes.push(n);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  const result = new Map<AdfNode, JiraAttachment>();
  const used = new Set<string>();
  for (const n of nodes) {
    const name = String(n.attrs?.alt ?? n.attrs?.__fileName ?? "");
    const match = name && attachments.find((a) => a.filename === name && !used.has(a.id));
    if (match) {
      result.set(n, match);
      used.add(match.id);
    }
  }
  if (fallbackInOrder) {
    const images = attachments.filter((a) => a.mimeType.startsWith("image/") && !used.has(a.id));
    for (const n of nodes) if (!result.has(n) && images.length) result.set(n, images.shift()!);
  }
  return result;
}

export function toComment(raw: { id: string; author?: unknown; created?: string; body?: unknown }): JiraComment {
  return { id: raw.id, author: name(raw.author) ?? "Unknown", created: raw.created ?? "", body: (raw.body as AdfNode | null) ?? null };
}

/**
 * Boards matching a search on board name, project name or project key (a
 * project's board is often called "SG board" or "Sprint board", so searching
 * the project's name has to find it too). Sorted by board name.
 */
export function matchBoards(boards: JiraBoardRef[], query: string): JiraBoardRef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return boards
    .filter((b) => {
      const text = `${b.name} ${b.projectName ?? ""} ${b.projectKey ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const issueUrl = (site: string, key: string) => `${site}/browse/${key}`;

// ---------------------------------------------------------------- sorting & filtering (overview)

const PRIORITY_RANK: Record<string, number> = { highest: 5, blocker: 5, critical: 5, high: 4, major: 4, medium: 3, low: 2, minor: 2, lowest: 1, trivial: 1 };
export const priorityRank = (p: string | null) => (p ? (PRIORITY_RANK[p.toLowerCase()] ?? 0) : 0);

export type IssueSort = "updated" | "priority" | "due" | "created" | "key";

export const SORT_LABELS: Record<IssueSort, string> = {
  updated: "Last updated",
  priority: "Priority",
  due: "Due date",
  created: "Newest",
  key: "Key",
};

/** "WEB-9" before "WEB-12". */
function compareKeys(a: string, b: string) {
  const [pa, na] = a.split("-");
  const [pb, nb] = b.split("-");
  return pa.localeCompare(pb) || Number(na) - Number(nb);
}

export function sortIssues(issues: JiraIssue[], sort: IssueSort): JiraIssue[] {
  const by: Record<IssueSort, (a: JiraIssue, b: JiraIssue) => number> = {
    updated: (a, b) => b.updated.localeCompare(a.updated),
    priority: (a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.updated.localeCompare(a.updated),
    due: (a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || priorityRank(b.priority) - priorityRank(a.priority),
    created: (a, b) => b.created.localeCompare(a.created),
    key: (a, b) => compareKeys(a.key, b.key),
  };
  return [...issues].sort(by[sort]);
}

export interface IssueFilter {
  text?: string;
  /** Project keys; empty = all. */
  projects?: string[];
  /** Status categories; empty = all. */
  categories?: StatusCategory[];
  /** Priority names; empty = all. */
  priorities?: string[];
}

export function filterIssues(issues: JiraIssue[], f: IssueFilter): JiraIssue[] {
  const text = f.text?.trim().toLowerCase();
  return issues.filter(
    (i) =>
      (!text || i.summary.toLowerCase().includes(text) || i.key.toLowerCase().includes(text)) &&
      (!f.projects?.length || f.projects.includes(i.project.key)) &&
      (!f.categories?.length || f.categories.includes(i.statusCategory)) &&
      (!f.priorities?.length || (i.priority !== null && f.priorities.includes(i.priority))),
  );
}

/** Plain text of an ADF document (search, previews). */
export function adfText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return String(node.attrs?.text ?? "");
  const inner = (node.content ?? []).map(adfText).join("");
  return ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(node.type) ? inner + "\n" : inner;
}
