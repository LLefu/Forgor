import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { notifyNew, pollForNotifications } from "@/app/notifications";
import { listFolders } from "@/data/notes";
import { prRef, sameRepo, type BitbucketRepoRef } from "@/lib/bitbucket";
import { repoPullRequestsQuery } from "./state";
import type { PluginNotificationKind } from "../types";

export const BITBUCKET_NOTIFICATIONS: PluginNotificationKind[] = [
  { kind: "review", label: "New review requests", hint: "When someone asks you to review a pull request in a repository linked to a folder." },
];

/** Every few minutes (the plugin's `start`, main window): the review requests in the linked repositories (the lists' own cached queries). */
export function startBitbucketNotifications(): () => void {
  return pollForNotifications(async () => {
    const account = useUI.getState().settings.bitbucketAccount;
    if (!account) return;
    const repos: BitbucketRepoRef[] = [];
    for (const f of await listFolders()) for (const r of f.bitbucketRepos ?? []) if (!repos.some((x) => sameRepo(x, r))) repos.push(r);
    const reviews = [];
    for (const repo of repos) {
      const { queryKey, queryFn } = repoPullRequestsQuery(account, repo);
      const prs = await queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });
      reviews.push(...prs.filter((p) => p.role === "review" && p.state === "OPEN"));
    }
    await notifyNew(
      "bitbucket",
      "review",
      // In the history: Pull requests with the PR's panel.
      reviews.map((p) => ({ id: prRef(p), title: `${p.author.name} asked you to review`, body: `${p.title} (${p.repo.name} #${p.id})`, open: { page: "overview", panel: "pr", panelParam: prRef(p) } })),
      { summary: (n) => ({ title: `${n} new review requests`, body: "Open Forgor to see them." }) },
    );
  });
}
