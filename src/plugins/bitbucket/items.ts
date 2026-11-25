import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { listFolders } from "@/data/notes";
import { approvedByMe, mergePullRequests, myReview, prRef, type PullRequest } from "@/lib/bitbucket";
import type { BitbucketAccount } from "@/platform/bitbucket";
import type { Folder } from "@/data/types";
import type { PluginItem, PluginItemSource } from "../types";
import { folderForPullRequest, myPullRequestsQuery, openPullRequest, repoPullRequestsQuery } from "./state";

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

/** For other plugins (an overview): my open pull requests and review requests. */
export const bitbucketItems: PluginItemSource = {
  kind: "Pull request",
  async items(): Promise<PluginItem[]> {
    const found = await openPullRequests(true);
    if (!found) return [];
    const { account, folders, prs } = found;
    return prs.map((p) => ({
      id: prRef(p),
      title: p.title,
      key: `${p.repo.slug}#${p.id}`,
      status: p.role === "mine" ? (p.draft ? "Draft" : "Open") : STATUS[myReview(p, account.uuid)],
      done: false,
      createdAt: p.created,
      updatedAt: p.updated,
      dueDate: null,
      estimateMin: null,
      folderId: folderForPullRequest(folders, p)?.id ?? null,
      url: p.url,
      open: () => openPullRequest(prRef(p)),
    }));
  },
};
