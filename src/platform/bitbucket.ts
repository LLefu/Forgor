import { isTauri } from "./env";

/**
 * Bitbucket Cloud (src-tauri/src/bitbucket.rs): Atlassian email + an API token
 * with Bitbucket scopes, the token kept in the OS keychain. Read-only GETs on
 * api.bitbucket.org/2.0. The browser build (demo, e2e) gets a fake that answers
 * the same paths with the same shapes.
 */

export interface BitbucketAccount {
  /** "{…}", how pull requests name authors and reviewers. */
  uuid: string;
  displayName: string;
  email: string;
}

export interface BitbucketBackend {
  /** Checks the token with Bitbucket and stores it in the keychain. */
  connect(email: string, token: string): Promise<BitbucketAccount>;
  disconnect(account: BitbucketAccount): Promise<void>;
  /** GET an API path ("/2.0/…"). */
  get<T>(account: BitbucketAccount, path: string): Promise<T>;
}

let backend: BitbucketBackend | null = null;

export function bitbucket(): BitbucketBackend {
  backend ??= isTauri() ? tauriBackend() : fakeBackend();
  return backend;
}

function tauriBackend(): BitbucketBackend {
  const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  return {
    connect: (email, token) => invoke("bitbucket_connect", { email, token }),
    disconnect: (a) => invoke("bitbucket_disconnect", { email: a.email }),
    get: (a, path) => invoke("bitbucket_get", { email: a.email, path }),
  };
}

// ---------------------------------------------------------------- browser fake

const user = (name: string) => ({ uuid: `{${name.toLowerCase().replace(/\s+/g, "-")}}`, display_name: name, nickname: name.split(" ")[0].toLowerCase() });
const ME = user("Demo User");
const SANNE = user("Sanne de Vries");
const JOOST = user("Joost Bakker");
const LISA = user("Lisa Jansen");

const REPOS = [
  { workspace: "acme", slug: "website", name: "Website" },
  { workspace: "acme", slug: "mobile-app", name: "Mobile app" },
  { workspace: "acme", slug: "infra", name: "Infrastructure" },
  { workspace: "side-projects", slug: "blog", name: "Blog" },
];

const LONG = [
  "The hero image was loaded at full size on every screen. This adds responsive sizes and lazy loading below the fold.",
  "",
  "## What changed",
  "- `srcset` with three sizes",
  "- `loading=\"lazy\"` for everything below the fold",
  "- A placeholder colour while it loads",
  "",
  "## How to test",
  "Open the homepage on a phone (or throttle the network) and check the hero shows within a second.",
  "",
  "See [the ticket](https://acme.atlassian.net/browse/WEB-12) for the measurements.",
].join("\n");

type FakePr = {
  id: number;
  repo: (typeof REPOS)[number];
  title: string;
  author: typeof ME;
  source: string;
  destination: string;
  draft?: boolean;
  state?: "OPEN" | "MERGED";
  comments: number;
  tasks?: number;
  updated: string;
  description: string;
  reviewers: { user: typeof ME; state: "approved" | "changes_requested" | null }[];
  files: { lines_added: number; lines_removed: number }[];
  builds?: { key: string; name: string; state: string; updated_on: string }[];
};

const PRS: FakePr[] = [
  {
    id: 42, repo: REPOS[0], title: "WEB-12 Faster hero image on mobile", author: ME, source: "feature/WEB-12-hero-image", destination: "main",
    comments: 3, tasks: 1, updated: "2026-10-20T15:30:00.000000+00:00", description: LONG,
    reviewers: [{ user: SANNE, state: "approved" }, { user: JOOST, state: null }],
    files: [{ lines_added: 120, lines_removed: 14 }, { lines_added: 8, lines_removed: 2 }, { lines_added: 0, lines_removed: 30 }],
    builds: [
      { key: "pipeline", name: "Pipeline #311", state: "SUCCESSFUL", updated_on: "2026-10-20T15:40:00.000000+00:00" },
      { key: "e2e", name: "End-to-end tests", state: "INPROGRESS", updated_on: "2026-10-20T15:41:00.000000+00:00" },
    ],
  },
  {
    id: 17, repo: REPOS[1], title: "Skip button in onboarding", author: SANNE, source: "feature/app-38-skip", destination: "develop",
    comments: 1, updated: "2026-10-21T08:10:00.000000+00:00", description: "Adds a skip button to every onboarding step.",
    reviewers: [{ user: ME, state: null }, { user: LISA, state: "changes_requested" }],
    files: [{ lines_added: 45, lines_removed: 3 }],
    builds: [{ key: "pipeline", name: "Pipeline #298", state: "FAILED", updated_on: "2026-10-21T08:15:00.000000+00:00" }],
  },
  {
    id: 18, repo: REPOS[1], title: "Upgrade React Native to 0.79", author: JOOST, source: "chore/rn-079", destination: "develop", draft: true,
    comments: 0, updated: "2026-10-19T12:00:00.000000+00:00", description: "",
    reviewers: [{ user: ME, state: "approved" }],
    files: Array.from({ length: 12 }, (_, i) => ({ lines_added: 10 + i, lines_removed: i })),
  },
  {
    id: 7, repo: REPOS[3], title: "New post: notes on Tauri", author: ME, source: "post/tauri", destination: "main",
    comments: 0, updated: "2026-10-18T09:00:00.000000+00:00", description: "A post about building a desktop app.",
    reviewers: [], files: [{ lines_added: 80, lines_removed: 0 }],
  },
  // Not mine, not reviewing: never shown
  {
    id: 43, repo: REPOS[0], title: "Cookie banner texts", author: LISA, source: "feature/WEB-9", destination: "main",
    comments: 2, updated: "2026-10-20T10:00:00.000000+00:00", description: "", reviewers: [{ user: SANNE, state: null }], files: [],
  },
  // Merged: never shown
  {
    id: 40, repo: REPOS[0], title: "Analytics setup", author: ME, source: "feature/WEB-3", destination: "main", state: "MERGED",
    comments: 5, updated: "2026-10-01T10:00:00.000000+00:00", description: "", reviewers: [{ user: SANNE, state: "approved" }], files: [],
  },
];

/** Browser build / e2e: make things happen in the fake (for notifications). */
export const fakeBitbucket = {
  /** Someone asks me to review a new PR in a repository ("acme/mobile-app"). */
  requestReview(repo: string, id: number, title: string) {
    const r = REPOS.find((x) => `${x.workspace}/${x.slug}` === repo)!;
    PRS.push({ id, repo: r, title, author: LISA, source: `feature/new-${id}`, destination: "main", comments: 0, updated: new Date().toISOString(), description: "", reviewers: [{ user: ME, state: null }], files: [] });
  },
};

function rawPr(p: FakePr) {
  const repository = { full_name: `${p.repo.workspace}/${p.repo.slug}`, name: p.repo.name };
  return {
    id: p.id,
    title: p.title,
    state: p.state ?? "OPEN",
    draft: !!p.draft,
    author: p.author,
    source: { branch: { name: p.source }, repository },
    destination: { branch: { name: p.destination }, repository },
    comment_count: p.comments,
    task_count: p.tasks ?? 0,
    created_on: "2026-10-15T09:00:00.000000+00:00",
    updated_on: p.updated,
    description: p.description,
    links: { html: { href: `https://bitbucket.org/${p.repo.workspace}/${p.repo.slug}/pull-requests/${p.id}` } },
    reviewers: p.reviewers.map((r) => r.user),
    participants: [
      ...p.reviewers.map((r) => ({ user: r.user, role: "REVIEWER", approved: r.state === "approved", state: r.state })),
      { user: p.author, role: "PARTICIPANT", approved: false, state: null },
    ],
  };
}

/** The part of Bitbucket's query language the app uses: `author.uuid="x" OR reviewers.uuid="x"`. */
function matches(p: FakePr, q: string) {
  const author = /author\.uuid="([^"]+)"/.exec(q)?.[1];
  const reviewer = /reviewers\.uuid="([^"]+)"/.exec(q)?.[1];
  return (!!author && p.author.uuid === author) || (!!reviewer && p.reviewers.some((r) => r.user.uuid === reviewer));
}

function fakeBackend(): BitbucketBackend {
  const tick = () => new Promise((r) => setTimeout(r, 30));
  return {
    connect: async (email, token) => {
      await tick();
      if (!email.trim() || !token.trim()) throw new Error("Enter your email and an API token");
      if (token.trim() === "wrong") throw new Error("Bitbucket didn't accept the email and API token (wrong, expired, revoked, or a token without Bitbucket scopes). Connect again in the Bitbucket plugin's settings.");
      return { uuid: ME.uuid, displayName: ME.display_name, email: email.trim() };
    },
    disconnect: async () => {},
    get: async <T,>(_account: BitbucketAccount, path: string): Promise<T> => {
      await tick();
      const url = new URL(path, "https://api.bitbucket.org");
      const p = url.pathname;
      const q = url.searchParams;
      const open = (list: FakePr[]) => list.filter((x) => (x.state ?? "OPEN") === (q.get("state") ?? "OPEN"));
      let m: RegExpExecArray | null;
      if (p === "/2.0/user") return { ...ME, account_id: "demo" } as T;
      if (p === "/2.0/user/workspaces") {
        const slugs = [...new Set(REPOS.map((r) => r.workspace))];
        return { values: slugs.map((slug) => ({ workspace: { slug, name: slug === "acme" ? "Acme" : "Side projects" } })) } as T;
      }
      if ((m = /^\/2\.0\/repositories\/([^/]+)$/.exec(p))) {
        const ws = decodeURIComponent(m[1]);
        return { values: REPOS.filter((r) => r.workspace === ws).map((r) => ({ slug: r.slug, name: r.name, full_name: `${r.workspace}/${r.slug}`, workspace: { slug: r.workspace } })) } as T;
      }
      if ((m = /^\/2\.0\/repositories\/([^/]+)\/([^/]+)\/pullrequests$/.exec(p))) {
        const [ws, slug] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
        if (!REPOS.some((r) => r.workspace === ws && r.slug === slug)) throw new Error("Not found in Bitbucket (deleted, or no access).");
        return { values: open(PRS.filter((x) => x.repo.workspace === ws && x.repo.slug === slug && matches(x, q.get("q") ?? ""))).map(rawPr) } as T;
      }
      // Gone in the real API (cross-workspace): the app must not use it.
      if (/^\/2\.0\/pullrequests\/[^/]+$/.test(p)) throw new Error("Not found in Bitbucket (deleted, or no access).");
      if ((m = /^\/2\.0\/workspaces\/([^/]+)\/pullrequests\/([^/]+)$/.exec(p))) {
        const [ws, uuid] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
        // Like the real one, it ignores `state=OPEN` (merged PRs come back too): the app must filter.
        return { values: PRS.filter((x) => x.repo.workspace === ws && x.author.uuid === uuid).map(rawPr) } as T;
      }
      if ((m = /^\/2\.0\/repositories\/([^/]+)\/([^/]+)\/pullrequests\/(\d+)(\/diffstat|\/statuses)?$/.exec(p))) {
        const pr = PRS.find((x) => x.repo.workspace === decodeURIComponent(m![1]) && x.repo.slug === decodeURIComponent(m![2]) && x.id === Number(m![3]));
        if (!pr) throw new Error("Not found in Bitbucket (deleted, or no access).");
        if (m[4] === "/statuses") return { values: (pr.builds ?? []).map((b) => ({ ...b, url: `https://bitbucket.org/${pr.repo.workspace}/${pr.repo.slug}/pipelines` })) } as T;
        return (m[4] ? { values: pr.files.map((f) => ({ ...f, status: "modified" })) } : rawPr(pr)) as T;
      }
      throw new Error(`Fake Bitbucket doesn't know ${p}`);
    },
  };
}
