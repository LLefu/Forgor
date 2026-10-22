import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { listFolders } from "@/data/notes";
import { approvedByMe, myReview, plainDescription, prRef, sameRepo, type BitbucketRepoRef, type PullRequest } from "@/lib/bitbucket";
import type { PluginChatItem, PluginChatSource } from "../types";
import { openPullRequest, repoPullRequestsQuery } from "./state";

const REVIEW: Record<string, string> = { approved: "goedgekeurd door mij", changes_requested: "ik vroeg om wijzigingen", waiting: "wacht op mijn review" };

function line(p: PullRequest, me: string) {
  const approvals = p.reviewers.filter((r) => r.state === "approved").length;
  const who = p.role === "mine" ? "van mij" : `van ${p.author.name}, ${REVIEW[myReview(p, me)]}`;
  return `${p.repo.name} #${p.id}, ${who}, ${approvals}/${p.reviewers.length} goedgekeurd, ${p.source} → ${p.destination}, bijgewerkt ${p.updated.slice(0, 10)}`;
}

/** For the AI chat: open pull requests in repositories linked to a folder (the lists' cached queries), except reviews I already approved. */
export const bitbucketChat: PluginChatSource = {
  kind: "Pull request",
  async items(): Promise<PluginChatItem[]> {
    const account = useUI.getState().settings.bitbucketAccount;
    if (!account) return [];
    const folders = await listFolders();
    const repos: { repo: BitbucketRepoRef; folderId: string }[] = [];
    for (const f of folders) for (const r of f.bitbucketRepos ?? []) if (!repos.some((x) => sameRepo(x.repo, r))) repos.push({ repo: r, folderId: f.id });
    const out: PluginChatItem[] = [];
    for (const { repo, folderId } of repos) {
      const { queryKey, queryFn } = repoPullRequestsQuery(account, repo);
      const prs = await queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });
      for (const p of prs.filter((x) => x.state === "OPEN" && !approvedByMe(x, account.uuid))) {
        out.push({
          id: prRef(p),
          title: p.title,
          text: line(p, account.uuid),
          folderId,
          open: () => openPullRequest(prRef(p)),
          detail: async () => [line(p, account.uuid), plainDescription(p.description).slice(0, 1500)].filter(Boolean).join("\n\n"),
        });
      }
    }
    return out;
  },
};
