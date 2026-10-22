import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { listFolders } from "@/data/notes";
import { adfText, paths, toComment, toIssue, type JiraIssue } from "@/lib/jira";
import { jira } from "@/platform/jira";
import type { PluginChatItem, PluginChatSource } from "../types";
import { myIssuesQuery, openIssue } from "./state";

const line = (i: JiraIssue) =>
  [`${i.status}`, i.type, i.priority && `prioriteit ${i.priority}`, `project ${i.project.name}`, i.due && `deadline ${i.due}`, `bijgewerkt ${i.updated.slice(0, 10)}`].filter(Boolean).join(", ");

/** For the AI chat: my open tickets (the overview's cached query), in the folder their project's board is linked to. */
export const jiraChat: PluginChatSource = {
  kind: "Jira-ticket",
  async items(): Promise<PluginChatItem[]> {
    const account = useUI.getState().settings.jiraAccount;
    if (!account) return [];
    const { queryKey, queryFn } = myIssuesQuery(account, false);
    const [issues, folders] = await Promise.all([queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 }), listFolders()]);
    return issues.map((i) => ({
      id: i.key,
      title: `${i.key} ${i.summary}`,
      text: line(i),
      folderId: folders.find((f) => f.jiraBoards?.some((b) => b.projectKey === i.project.key))?.id ?? null,
      open: () => openIssue(i.key),
      // Attached: the description and the latest comments (the panel's own queries).
      detail: async () => {
        const get = <T,>(path: string) => jira().get<T>(account, path);
        const [full, comments] = await Promise.all([
          queryClient.fetchQuery({ queryKey: ["jira", account.site, "issue", i.key], queryFn: async () => toIssue(await get(paths.issue(i.key))), staleTime: 60_000 }),
          queryClient.fetchQuery({
            queryKey: ["jira", account.site, "comments", i.key],
            queryFn: async () => (await get<{ comments: { id: string; author?: unknown; created?: string; body?: unknown }[] }>(paths.comments(i.key))).comments.map(toComment),
            staleTime: 60_000,
          }),
        ]);
        const description = adfText(full.description).trim().slice(0, 1500);
        const latest = comments.slice(-5).map((c) => `- ${c.author} (${c.created.slice(0, 10)}): ${adfText(c.body).replace(/\s+/g, " ").trim().slice(0, 300)}`);
        return [line(full), description && `Beschrijving:\n${description}`, latest.length && `Laatste reacties:\n${latest.join("\n")}`].filter(Boolean).join("\n\n");
      },
    }));
  },
};
