import { myReview, plainDescription, prRef, type PullRequest } from "@/lib/bitbucket";
import type { PluginChatItem, PluginChatSource } from "../types";
import { openPullRequests } from "./items";
import { folderForPullRequest, openPullRequest } from "./state";

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
    const found = await openPullRequests(false);
    if (!found) return [];
    const { account, folders, prs } = found;
    return prs.map((p) => ({
      id: prRef(p),
      title: p.title,
      text: line(p, account.uuid),
      folderId: folderForPullRequest(folders, p)?.id ?? null,
      open: () => openPullRequest(prRef(p)),
      detail: async () => [line(p, account.uuid), plainDescription(p.description).slice(0, 1500)].filter(Boolean).join("\n\n"),
    }));
  },
};
