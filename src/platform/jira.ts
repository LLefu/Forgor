import { isTauri } from "./env";

/**
 * Jira Cloud (src-tauri/src/jira.rs): email + API token, the token kept in the
 * OS keychain. Read-only GETs on the REST API. The browser build (demo, e2e)
 * gets a fake site that answers the same paths with the same shapes.
 */

export interface JiraAccount {
  /** "https://acme.atlassian.net" */
  site: string;
  accountId: string;
  displayName: string;
  email: string;
}

export interface JiraBackend {
  /** Checks the token with Jira and stores it in the keychain. */
  connect(site: string, email: string, token: string): Promise<JiraAccount>;
  disconnect(account: JiraAccount): Promise<void>;
  /** GET a REST path ("/rest/api/3/…", "/rest/agile/1.0/…"). */
  get<T>(account: JiraAccount, path: string): Promise<T>;
  /** An attachment's bytes (they need the login, so the webview can't load them itself). */
  attachment(account: JiraAccount, id: string): Promise<ArrayBuffer>;
}

let backend: JiraBackend | null = null;

export function jira(): JiraBackend {
  backend ??= isTauri() ? tauriBackend() : fakeBackend();
  return backend;
}

function tauriBackend(): JiraBackend {
  const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
  return {
    connect: (site, email, token) => invoke("jira_connect", { site, email, token }),
    disconnect: (a) => invoke("jira_disconnect", { site: a.site, email: a.email }),
    get: (a, path) => invoke("jira_get", { site: a.site, email: a.email, path }),
    attachment: (a, id) => invoke("jira_attachment", { site: a.site, email: a.email, id }),
  };
}

// ---------------------------------------------------------------- browser fake

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  version: 1,
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

const person = (name: string) => ({ accountId: name.toLowerCase(), displayName: name });
const ME = person("Demo User");

const STATUS = {
  todo: { name: "To Do", statusCategory: { key: "new", name: "To Do" } },
  progress: { name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } },
  review: { name: "In Review", statusCategory: { key: "indeterminate", name: "In Progress" } },
  done: { name: "Done", statusCategory: { key: "done", name: "Done" } },
};

const PROJECTS = { WEB: { key: "WEB", name: "Website" }, APP: { key: "APP", name: "Mobile app" } };

const FAKE_ISSUES = [
  { key: "WEB-12", summary: "Homepage hero loads slowly on mobile", status: STATUS.progress, priority: "High", type: "Bug", project: PROJECTS.WEB, due: "2026-10-20", updated: "2026-10-12T09:30:00.000+0200" },
  { key: "WEB-15", summary: "Add dark mode to the marketing site", status: STATUS.todo, priority: "Medium", type: "Story", project: PROJECTS.WEB, due: null, updated: "2026-10-10T14:00:00.000+0200" },
  { key: "WEB-9", summary: "Update cookie banner texts", status: STATUS.review, priority: "Low", type: "Task", project: PROJECTS.WEB, due: "2026-10-15", updated: "2026-10-11T11:00:00.000+0200" },
  { key: "WEB-3", summary: "Set up analytics", status: STATUS.done, priority: "Medium", type: "Task", project: PROJECTS.WEB, due: null, updated: "2026-10-01T10:00:00.000+0200" },
  { key: "APP-41", summary: "Crash when opening notifications on Android 14", status: STATUS.todo, priority: "Highest", type: "Bug", project: PROJECTS.APP, due: "2026-10-14", updated: "2026-10-12T16:45:00.000+0200" },
  { key: "APP-38", summary: "Onboarding: skip button", status: STATUS.progress, priority: "Medium", type: "Story", project: PROJECTS.APP, due: null, updated: "2026-10-09T08:15:00.000+0200" },
];

const FAKE_BOARDS = [
  { id: 1, name: "WEB board", type: "scrum", location: { projectKey: "WEB", projectName: "Website", displayName: "Website (WEB)" } },
  { id: 2, name: "APP board", type: "kanban", location: { projectKey: "APP", projectName: "Mobile app", displayName: "Mobile app (APP)" } },
  // A board not named after its project, and enough boards for more than one page (50)
  { id: 3, name: "Sprint board", type: "scrum", location: { projectKey: "SG", projectName: "Schadegarant", displayName: "Schadegarant (SG)" } },
  ...Array.from({ length: 60 }, (_, i) => ({ id: 100 + i, name: `Team ${i + 1} board`, type: "kanban", location: { projectKey: "OPS", projectName: "Operations", displayName: "Operations (OPS)" } })),
];

function fakeIssue(i: (typeof FAKE_ISSUES)[number]) {
  return {
    id: i.key,
    key: i.key,
    fields: {
      summary: i.summary,
      status: i.status,
      priority: { name: i.priority },
      issuetype: { name: i.type },
      project: i.project,
      assignee: ME,
      reporter: person("Sanne de Vries"),
      created: "2026-09-30T10:00:00.000+0200",
      updated: i.updated,
      duedate: i.due,
      labels: i.key === "WEB-12" ? ["performance"] : [],
      description:
        i.key === "WEB-12"
          ? { ...doc(`Description of ${i.key}.`), content: [...doc(`Description of ${i.key}.`).content, { type: "mediaSingle", content: [{ type: "media", attrs: { id: "abc", type: "file", alt: "hero.svg" } }] }] }
          : doc(`Description of ${i.key}.`, "Steps to reproduce: open the page on a phone."),
      attachment: i.key === "WEB-12" ? [{ id: "10001", filename: "hero.svg", mimeType: "image/svg+xml", size: 300 }] : [],
    },
  };
}

/** What the fake understands of a JQL query: open only, project, and "assigned to me" (always true here). */
function fakeSearch(jql: string) {
  const open = /statusCategory\s*!=\s*Done/i.test(jql) && !/OR updated/i.test(jql);
  const project = /project\s*=\s*"?(\w+)"?/i.exec(jql)?.[1];
  return FAKE_ISSUES.filter((i) => (!open || i.status !== STATUS.done) && (!project || i.project.key === project)).map(fakeIssue);
}

function fakeBackend(): JiraBackend {
  const tick = () => new Promise((r) => setTimeout(r, 30));
  return {
    connect: async (site, email, token) => {
      await tick();
      if (!token.trim()) throw new Error("Enter your email and an API token");
      if (token.trim() === "wrong") throw new Error("Jira didn't accept the email and API token (wrong, expired or revoked). Connect again in Settings → Jira.");
      const host = site.trim().replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
      return { site: `https://${host.includes(".") ? host : `${host}.atlassian.net`}`, accountId: ME.accountId, displayName: ME.displayName, email: email.trim() };
    },
    disconnect: async () => {},
    attachment: async () => {
      await tick();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#6366f1"/><text x="20" y="70" font-size="28" fill="white">hero.svg</text></svg>`;
      return new TextEncoder().encode(svg).buffer as ArrayBuffer;
    },
    get: async <T,>(_account: JiraAccount, path: string): Promise<T> => {
      await tick();
      const url = new URL(path, "https://fake.atlassian.net");
      const p = url.pathname;
      const q = url.searchParams;
      let m: RegExpExecArray | null;
      if (p === "/rest/api/3/myself") return { ...ME, emailAddress: "demo@example.com" } as T;
      if (p === "/rest/agile/1.0/board") {
        const start = Number(q.get("startAt") ?? 0);
        const size = Number(q.get("maxResults") ?? 50);
        return { values: FAKE_BOARDS.slice(start, start + size), startAt: start, isLast: start + size >= FAKE_BOARDS.length } as T;
      }
      if ((m = /^\/rest\/agile\/1\.0\/board\/(\d+)\/issue$/.exec(p))) {
        const board = FAKE_BOARDS.find((b) => b.id === Number(m![1]));
        if (!board) throw new Error("Not found in Jira (deleted, or no access).");
        const issues = fakeSearch(`${q.get("jql") ?? ""} project = ${board.location.projectKey}`);
        return { issues, total: issues.length, startAt: 0, maxResults: 100 } as T;
      }
      if (p === "/rest/api/3/search/jql") return { issues: fakeSearch(q.get("jql") ?? ""), isLast: true } as T;
      if ((m = /^\/rest\/api\/3\/issue\/([\w-]+)\/comment$/.exec(p))) {
        return {
          comments: [
            { id: "1", author: person("Sanne de Vries"), created: "2026-10-11T09:00:00.000+0200", updated: "2026-10-11T09:00:00.000+0200", body: doc("Can you look at this before Friday?") },
            { id: "2", author: ME, created: "2026-10-12T10:00:00.000+0200", updated: "2026-10-12T10:00:00.000+0200", body: doc(`On it. ${m[1]} is next.`) },
          ],
          total: 2,
        } as T;
      }
      if ((m = /^\/rest\/api\/3\/issue\/([\w-]+)$/.exec(p))) {
        const issue = FAKE_ISSUES.find((i) => i.key === m![1]);
        if (!issue) throw new Error("Not found in Jira (deleted, or no access).");
        return fakeIssue(issue) as T;
      }
      throw new Error(`Fake Jira doesn't know ${p}`);
    },
  };
}
