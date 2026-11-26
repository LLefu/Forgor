import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { listFolders } from "@/data/notes";
import { issueUrl, type JiraIssue } from "@/lib/jira";
import type { JiraAccount } from "@/platform/jira";
import type { Folder } from "@/data/types";
import type { PluginItem, PluginItemSource } from "../types";
import { myDoneIssuesQuery, myIssuesQuery, openIssue } from "./state";

/** My open tickets (the overview's cached query), or null while Jira isn't connected. */
export async function myOpenIssues(): Promise<{ account: JiraAccount; folders: Folder[]; issues: JiraIssue[] } | null> {
  const account = useUI.getState().settings.jiraAccount;
  if (!account) return null;
  const { queryKey, queryFn } = myIssuesQuery(account, false);
  const [issues, folders] = await Promise.all([queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 }), listFolders()]);
  return { account, folders, issues };
}

/** The folder a project's board is linked to. */
export const folderForIssue = (folders: Folder[], i: JiraIssue) => folders.find((f) => f.jiraBoards?.some((b) => b.projectKey === i.project.key)) ?? null;

/** My tickets resolved in the last week; a failure here leaves them out instead of failing the whole list. */
async function recentlyDone(account: JiraAccount): Promise<JiraIssue[]> {
  return queryClient.fetchQuery({ ...myDoneIssuesQuery(account), staleTime: 60_000 }).catch((e) => {
    console.warn("Jira: finished tickets couldn't be loaded:", e);
    return [];
  });
}

/**
 * For other plugins (an overview): my open tickets (assigned to me, so they
 * wait for me) and the ones resolved in the last 7 days (`done`), so a ticket
 * that's finished can be told from one that was reassigned or deleted.
 */
export const jiraItems: PluginItemSource = {
  kind: "Jira ticket",
  async items(): Promise<PluginItem[]> {
    const found = await myOpenIssues();
    if (!found) return [];
    const { account, folders, issues } = found;
    const done = (await recentlyDone(account)).filter((d) => !issues.some((i) => i.key === d.key));
    return [...issues, ...done].map((i) => {
      const finished = i.statusCategory === "done";
      return {
        id: i.key,
        title: i.summary,
        key: i.key,
        status: i.status,
        done: finished,
        doneAt: finished ? (i.resolved ?? i.updated) : null,
        role: "assignee",
        needsMe: !finished,
        createdAt: i.created,
        updatedAt: i.updated,
        dueDate: i.due,
        estimateMin: i.estimateMin,
        folderId: folderForIssue(folders, i)?.id ?? null,
        url: issueUrl(account.site, i.key),
        open: () => openIssue(i.key),
      };
    });
  },
};
