/** Bitbucket Cloud data as Forgor shows it, and the requests that fetch it (pure; the hooks are in plugins/bitbucket/state.ts). */

/** A repository linked to a folder (stored on the folder). */
export interface BitbucketRepoRef {
  workspace: string;
  slug: string;
  name: string;
}

export type ReviewState = "approved" | "changes_requested" | "waiting";

export interface PrPerson {
  uuid: string;
  name: string;
}

export interface PrReviewer {
  person: PrPerson;
  state: ReviewState;
}

export interface PullRequest {
  id: number;
  repo: BitbucketRepoRef;
  title: string;
  draft: boolean;
  author: PrPerson;
  /** Branch names. */
  source: string;
  destination: string;
  commentCount: number;
  taskCount: number;
  created: string;
  updated: string;
  /** On bitbucket.org. */
  url: string;
  /** Markdown, as written (the list doesn't always have it; the detail does). */
  description: string;
  reviewers: PrReviewer[];
  /** Mine (I opened it) or one I'm asked to review. */
  role: "mine" | "review";
  /** OPEN, MERGED, DECLINED or SUPERSEDED. */
  state: string;
}

/** Lists only ever show open pull requests, whatever an endpoint sends. */
export const isOpen = (pr: PullRequest) => pr.state === "OPEN";

/** A build (pipeline, CI) reported on the PR's commits. */
export interface Build {
  key: string;
  name: string;
  state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "STOPPED";
  url: string;
  updated: string;
}

/** All builds together: failed wins, then running, then stopped; null without builds. */
export type BuildSummary = "failed" | "running" | "stopped" | "passed" | null;

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

/** The panel's param and a PR's identity: "workspace/repo/123". */
export const prRef = (pr: Pick<PullRequest, "repo" | "id">) => `${pr.repo.workspace}/${pr.repo.slug}/${pr.id}`;

export function parsePrRef(ref: string): { workspace: string; slug: string; id: number } | null {
  const m = /^([^/]+)\/([^/]+)\/(\d+)$/.exec(ref);
  return m ? { workspace: m[1], slug: m[2], id: Number(m[3]) } : null;
}

export const sameRepo = (a: Pick<BitbucketRepoRef, "workspace" | "slug">, b: Pick<BitbucketRepoRef, "workspace" | "slug">) =>
  a.workspace.toLowerCase() === b.workspace.toLowerCase() && a.slug.toLowerCase() === b.slug.toLowerCase();

const enc = encodeURIComponent;

export const paths = {
  user: () => "/2.0/user",
  workspaces: () => "/2.0/user/workspaces?pagelen=100",
  repos: (workspace: string) => `/2.0/repositories/${enc(workspace)}?role=member&pagelen=100&sort=-updated_on`,
  /** Open PRs in a repo that I opened or am a reviewer on. */
  repoPullRequests: (r: Pick<BitbucketRepoRef, "workspace" | "slug">, uuid: string) =>
    `/2.0/repositories/${enc(r.workspace)}/${enc(r.slug)}/pullrequests?state=OPEN&pagelen=50&q=${enc(`author.uuid="${uuid}" OR reviewers.uuid="${uuid}"`)}&fields=${enc("+values.participants,+values.reviewers")}`,
  /** My open PRs in every repo of a workspace (also ones not linked to a folder). The cross-workspace `/2.0/pullrequests/{user}` is gone (404). */
  myPullRequests: (workspace: string, uuid: string) =>
    // It ignores `state=OPEN` (merged ones came back), so the filter is in `q` too; isOpen() checks every PR anyway.
    `/2.0/workspaces/${enc(workspace)}/pullrequests/${enc(uuid)}?state=OPEN&pagelen=50&q=${enc('state="OPEN"')}&fields=${enc("+values.participants,+values.reviewers")}`,
  pullRequest: (workspace: string, slug: string, id: number) => `/2.0/repositories/${enc(workspace)}/${enc(slug)}/pullrequests/${id}`,
  statuses: (workspace: string, slug: string, id: number) => `/2.0/repositories/${enc(workspace)}/${enc(slug)}/pullrequests/${id}/statuses?pagelen=100`,
  diffstat: (workspace: string, slug: string, id: number) => `/2.0/repositories/${enc(workspace)}/${enc(slug)}/pullrequests/${id}/diffstat?pagelen=500`,
};

/** A `next` link from a page ("https://api.bitbucket.org/2.0/…") as a path for the backend, or null. */
export function nextPath(next: unknown): string | null {
  if (typeof next !== "string") return null;
  const prefix = "https://api.bitbucket.org";
  return next.startsWith(`${prefix}/2.0/`) ? next.slice(prefix.length) : null;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

function person(v: unknown): PrPerson {
  const p = obj(v);
  return { uuid: str(p.uuid), name: str(p.display_name) || str(p.nickname) || "Unknown" };
}

/** Bitbucket's pull request (list or detail) → Forgor's, from my point of view (`me` is my uuid). */
export function toPullRequest(raw: unknown, me: string): PullRequest {
  const r = obj(raw);
  const destRepo = obj(obj(r.destination).repository);
  const repo = destRepo.full_name ? destRepo : obj(obj(r.source).repository);
  const [workspace = "", slug = ""] = str(repo.full_name).split("/");
  const author = person(r.author);

  // Reviewers come in `reviewers` (everyone asked) and `participants` (with what they did).
  const states = new Map<string, ReviewState>();
  for (const p of Array.isArray(r.participants) ? r.participants : []) {
    const x = obj(p);
    const uuid = str(obj(x.user).uuid);
    if (!uuid) continue;
    const state: ReviewState = x.state === "changes_requested" ? "changes_requested" : x.approved === true || x.state === "approved" ? "approved" : "waiting";
    if (x.role === "REVIEWER" || state !== "waiting") states.set(uuid, state);
  }
  const reviewers: PrReviewer[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(r.reviewers) ? r.reviewers : []) {
    const p = person(v);
    if (!p.uuid || seen.has(p.uuid)) continue;
    seen.add(p.uuid);
    reviewers.push({ person: p, state: states.get(p.uuid) ?? "waiting" });
  }
  for (const p of Array.isArray(r.participants) ? r.participants : []) {
    const x = obj(p);
    const u = person(x.user);
    if (x.role === "REVIEWER" && u.uuid && !seen.has(u.uuid)) {
      seen.add(u.uuid);
      reviewers.push({ person: u, state: states.get(u.uuid) ?? "waiting" });
    }
  }

  return {
    id: Number(r.id),
    repo: { workspace, slug, name: str(repo.name) || slug },
    title: str(r.title),
    draft: r.draft === true,
    author,
    source: str(obj(obj(r.source).branch).name),
    destination: str(obj(obj(r.destination).branch).name),
    commentCount: Number(r.comment_count ?? 0) || 0,
    taskCount: Number(r.task_count ?? 0) || 0,
    created: str(r.created_on),
    updated: str(r.updated_on),
    url: str(obj(obj(r.links).html).href) || `https://bitbucket.org/${workspace}/${slug}/pull-requests/${Number(r.id)}`,
    description: str(r.description),
    reviewers,
    role: author.uuid && author.uuid === me ? "mine" : "review",
    state: str(r.state).toUpperCase(),
  };
}

/** How my own review stands (on a PR I'm asked to review). */
export const myReview = (pr: PullRequest, me: string): ReviewState => pr.reviewers.find((r) => r.person.uuid === me)?.state ?? "waiting";

/** Merges lists (a PR in two of them once), open ones only, last updated first. */
export function mergePullRequests(lists: PullRequest[][]): PullRequest[] {
  const byRef = new Map<string, PullRequest>();
  for (const list of lists) for (const pr of list) if (isOpen(pr)) byRef.set(prRef(pr), pr);
  return [...byRef.values()].sort((a, b) => b.updated.localeCompare(a.updated));
}

export function sumDiffstat(values: { lines_added?: number; lines_removed?: number }[]): DiffStat {
  return values.reduce<DiffStat>((s, v) => ({ files: s.files + 1, added: s.added + (v.lines_added ?? 0), removed: s.removed + (v.lines_removed ?? 0) }), { files: 0, added: 0, removed: 0 });
}

/** Bitbucket's commit statuses → the builds, the latest run per build (key) only (older commits report too). */
export function toBuilds(values: unknown[]): Build[] {
  const byKey = new Map<string, Build>();
  for (const v of values) {
    const x = obj(v);
    const state = str(x.state).toUpperCase();
    if (!["SUCCESSFUL", "FAILED", "INPROGRESS", "STOPPED"].includes(state)) continue;
    const b: Build = { key: str(x.key) || str(x.name), name: str(x.name) || str(x.key) || "Build", state: state as Build["state"], url: str(x.url), updated: str(x.updated_on) || str(x.created_on) };
    const prev = byKey.get(b.key);
    if (!prev || b.updated > prev.updated) byKey.set(b.key, b);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function summarizeBuilds(builds: Build[]): BuildSummary {
  if (!builds.length) return null;
  if (builds.some((b) => b.state === "FAILED")) return "failed";
  if (builds.some((b) => b.state === "INPROGRESS")) return "running";
  if (builds.some((b) => b.state === "STOPPED")) return "stopped";
  return "passed";
}

/** Words that start branch names but aren't Jira projects ("release-2026"). */
const NOT_KEYS = new Set(["RELEASE", "HOTFIX", "BUGFIX", "FEATURE", "FIX", "CHORE", "V", "REVERT", "DEPENDABOT"]);

/** Jira ticket keys in a PR's title and branch ("WEB-12", "feature/web-12-hero"), first seen first. */
export function jiraKeys(pr: Pick<PullRequest, "title" | "source">): string[] {
  const keys: string[] = [];
  const add = (k: string) => {
    const key = k.toUpperCase();
    if (!NOT_KEYS.has(key.split("-")[0]) && !keys.includes(key)) keys.push(key);
  };
  for (const m of pr.title.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g)) add(m[1]);
  for (const part of pr.source.split("/")) {
    const m = /^([A-Za-z][A-Za-z0-9]{1,9}-\d+)(?=$|[-_.])/.exec(part);
    if (m) add(m[1]);
  }
  return keys;
}

/** A description as readable plain text: links and images to their text, no markdown markers. */
export function plainDescription(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/`{3}[^\n]*\n?/g, "") // code fences
    .replace(/`([^`\n]+)`/g, "$1") // inline code
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function matchRepos(repos: BitbucketRepoRef[], query: string): BitbucketRepoRef[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || r.workspace.toLowerCase().includes(q));
}
