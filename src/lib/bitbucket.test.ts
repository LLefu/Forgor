import { describe, expect, it } from "vitest";
import { summarizeBuilds, toBuilds, jiraKeys, mergePullRequests, myReview, nextPath, parsePrRef, paths, plainDescription, prRef, sumDiffstat, toPullRequest } from "./bitbucket";

const ME = "{me}";
const raw = (over: Record<string, unknown> = {}) => ({
  id: 42,
  state: "OPEN",
  title: "WEB-12 Faster hero",
  draft: false,
  author: { uuid: ME, display_name: "Me" },
  source: { branch: { name: "feature/WEB-12-hero" }, repository: { full_name: "acme/website", name: "Website" } },
  destination: { branch: { name: "main" }, repository: { full_name: "acme/website", name: "Website" } },
  comment_count: 3,
  task_count: 1,
  updated_on: "2026-10-20T10:00:00+00:00",
  links: { html: { href: "https://bitbucket.org/acme/website/pull-requests/42" } },
  reviewers: [{ uuid: "{a}", display_name: "Ann" }, { uuid: "{b}", display_name: "Bob" }],
  participants: [
    { user: { uuid: "{a}", display_name: "Ann" }, role: "REVIEWER", approved: true, state: "approved" },
    { user: { uuid: "{b}", display_name: "Bob" }, role: "REVIEWER", approved: false, state: "changes_requested" },
    { user: { uuid: "{c}", display_name: "Cas" }, role: "PARTICIPANT", approved: false, state: null },
  ],
  ...over,
});

describe("toPullRequest", () => {
  it("reads a pull request from my point of view", () => {
    const pr = toPullRequest(raw(), ME);
    expect(pr).toMatchObject({ id: 42, repo: { workspace: "acme", slug: "website", name: "Website" }, source: "feature/WEB-12-hero", destination: "main", commentCount: 3, taskCount: 1, role: "mine" });
    expect(pr.reviewers.map((r) => [r.person.name, r.state])).toEqual([
      ["Ann", "approved"],
      ["Bob", "changes_requested"],
    ]);
    expect(prRef(pr)).toBe("acme/website/42");
  });

  it("is a review request when someone else opened it; my own review state", () => {
    const pr = toPullRequest(raw({ author: { uuid: "{x}", display_name: "X" }, reviewers: [{ uuid: ME, display_name: "Me" }], participants: [] }), ME);
    expect(pr.role).toBe("review");
    expect(myReview(pr, ME)).toBe("waiting");
  });

  it("copes with missing fields (the list leaves some out)", () => {
    const pr = toPullRequest({ id: 1, destination: { repository: { full_name: "a/b" } } }, ME);
    expect(pr).toMatchObject({ id: 1, repo: { workspace: "a", slug: "b" }, reviewers: [], commentCount: 0, url: "https://bitbucket.org/a/b/pull-requests/1" });
  });
});

describe("helpers", () => {
  it("merges lists once each, open ones only, last updated first", () => {
    const a = toPullRequest(raw({ id: 1, updated_on: "2026-10-01" }), ME);
    const b = toPullRequest(raw({ id: 2, updated_on: "2026-10-05" }), ME);
    const merged = toPullRequest(raw({ id: 3, state: "MERGED" }), ME);
    const declined = toPullRequest(raw({ id: 4, state: "DECLINED" }), ME);
    expect(mergePullRequests([[a, b, merged], [a, declined]]).map((p) => p.id)).toEqual([2, 1]);
  });

  it("finds Jira keys in the title and branch, not words like release-2026", () => {
    expect(jiraKeys({ title: "WEB-12 and APP-3", source: "feature/web-12-hero" })).toEqual(["WEB-12", "APP-3"]);
    expect(jiraKeys({ title: "Bump", source: "release-2026" })).toEqual([]);
    expect(jiraKeys({ title: "x", source: "bugfix/OPS-7_crash" })).toEqual(["OPS-7"]);
  });

  it("panel refs and next-page links", () => {
    expect(parsePrRef("acme/website/42")).toEqual({ workspace: "acme", slug: "website", id: 42 });
    expect(parsePrRef("nope")).toBeNull();
    expect(nextPath("https://api.bitbucket.org/2.0/user/workspaces?page=2")).toBe("/2.0/user/workspaces?page=2");
    expect(nextPath("https://evil.example/2.0/x")).toBeNull();
  });

  it("asks only for open PRs I opened or review", () => {
    const p = decodeURIComponent(paths.repoPullRequests({ workspace: "acme", slug: "web" }, ME));
    expect(p).toContain("state=OPEN");
    expect(p).toContain(`author.uuid="${ME}" OR reviewers.uuid="${ME}"`);
  });

  it("builds: the latest run per build, summed up (failed wins, then running)", () => {
    const builds = toBuilds([
      { key: "ci", name: "Pipeline", state: "FAILED", updated_on: "2026-10-01" },
      { key: "ci", name: "Pipeline", state: "SUCCESSFUL", updated_on: "2026-10-02" },
      { key: "lint", name: "Lint", state: "INPROGRESS", updated_on: "2026-10-02" },
      { key: "x", state: "WEIRD" },
    ]);
    expect(builds.map((b) => [b.name, b.state])).toEqual([
      ["Lint", "INPROGRESS"],
      ["Pipeline", "SUCCESSFUL"],
    ]);
    expect(summarizeBuilds(builds)).toBe("running");
    expect(summarizeBuilds(builds.slice(1))).toBe("passed");
    expect(summarizeBuilds([{ ...builds[0], state: "FAILED" }, ...builds])).toBe("failed");
    expect(summarizeBuilds([])).toBeNull();
  });

  it("sums the diffstat and turns markdown into plain text", () => {
    expect(sumDiffstat([{ lines_added: 3, lines_removed: 1 }, { lines_added: 2 }])).toEqual({ files: 2, added: 5, removed: 1 });
    expect(plainDescription("## What\n**Bold** and [a link](https://x) with `code`\n![img](y.png)")).toBe("What\nBold and a link with code");
  });
});
