import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { listFolders } from "@/data/notes";
import { approvedByMe, mergePullRequests, myReview, prRef, type PullRequest } from "@/lib/bitbucket";
import type { BitbucketAccount } from "@/platform/bitbucket";
import type { Folder } from "@/data/types";
import type { PluginItem, PluginItemSource } from "../types";
import { closedPullRequestsQuery, folderForPullRequest, myClosedPullRequestsQuery, myPullRequestsQuery, openPullRequest, repoPullRequestsQuery } from "./state";

const STALE = 60_000;

/**
 * Open pull requests I opened or review (the lists' cached queries): in the
 * repositories linked to a folder, plus with `withMine` my own everywhere.
 * Reviews I already approved are left out, like everywhere else.
 */
export async function openPullRequests(withMine: boolean): Promise<{ account: BitbucketAccount; folders: Folder[]; prs: PullRequest[] } | null> {
  const account = useUI.getState().settings.bitbucketAccount;
  if (!account) return null;
  const folders = await listFolders();
  const repos = folders.flatMap((f) => f.bitbucketRepos ?? []);
  const lists = await Promise.all(repos.map((r) => queryClient.fetchQuery({ ...repoPullRequestsQuery(account, r), staleTime: STALE })));
  if (withMine) {
    // Extra, like on the overview page: when it fails, the linked repositories still count.
    const mine = await queryClient.fetchQuery({ ...myPullRequestsQuery(account), staleTime: STALE }).catch((e) => {
      console.warn("Bitbucket: my pull requests in other repositories failed:", e);
      return [];
    });
    lists.push(mine);
  }
  const prs = mergePullRequests(lists).filter((p) => !approvedByMe(p, account.uuid));
  return { account, folders, prs };
}

const STATUS: Record<string, string> = { approved: "Approved", changes_requested: "Changes requested", waiting: "Review requested" };
const CLOSED: Record<string, string> = { MERGED: "Merged", DECLINED: "Declined" };

/** A week back, by the day (so the query key stays the same all day). */
const weekAgo = () => `${new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)}T00:00:00+00:00`;

/** PRs I opened or reviewed, merged or declined in the last week: linked repositories plus mine everywhere. A failure leaves them out. */
async function recentlyClosed(account: BitbucketAccount, folders: Folder[]): Promise<PullRequest[]> {
  const since = weekAgo();
  const repos = folders.flatMap((f) => f.bitbucketRepos ?? []);
  const lists = await Promise.all([
    ...repos.map((r) => queryClient.fetchQuery({ ...closedPullRequestsQuery(account, r, since), staleTime: STALE })),
    queryClient.fetchQuery({ ...myClosedPullRequestsQuery(account, since), staleTime: STALE }),
  ]).catch((e) => {
    console.warn("Bitbucket: finished pull requests couldn't be loaded:", e);
    return [] as PullRequest[][];
  });
  const byRef = new Map<string, PullRequest>();
  for (const pr of lists.flat()) if (CLOSED[pr.state] && Date.parse(pr.updated) >= Date.parse(since)) byRef.set(prRef(pr), pr);
  return [...byRef.values()];
}

/** Whether it waits for me: a review I haven't given yet, or my own PR with changes asked for. */
function waitsForMe(p: PullRequest, me: string): boolean {
  if (p.role === "review") return myReview(p, me) === "waiting";
  return p.reviewers.some((r) => r.state === "changes_requested");
}

/**
 * For other plugins (an overview): my open pull requests and review requests,
 * and the ones merged or declined in the last 7 days (`done`), so a finished
 * PR can be told from one that went away.
 */
export const bitbucketItems: PluginItemSource = {
  kind: "Pull request",
  async items(): Promise<PluginItem[]> {
    const found = await openPullRequests(true);
    if (!found) return [];
    const { account, folders, prs } = found;
    const closed = (await recentlyClosed(account, folders)).filter((c) => !prs.some((p) => prRef(p) === prRef(c)));
    const item = (p: PullRequest): PluginItem => {
      const done = !!CLOSED[p.state];
      return {
        id: prRef(p),
        title: p.title,
        key: `${p.repo.slug}#${p.id}`,
        status: done ? CLOSED[p.state] : p.role === "mine" ? (p.draft ? "Draft" : "Open") : STATUS[myReview(p, account.uuid)],
        done,
        doneAt: done ? p.updated : null,
        role: p.role === "mine" ? "author" : "reviewer",
        needsMe: !done && waitsForMe(p, account.uuid),
        createdAt: p.created,
        updatedAt: p.updated,
        dueDate: null,
        estimateMin: null,
        folderId: folderForPullRequest(folders, p)?.id ?? null,
        url: p.url,
        open: () => openPullRequest(prRef(p)),
      };
    };
    return [...prs.map(item), ...closed.map(item)];
  },
};
