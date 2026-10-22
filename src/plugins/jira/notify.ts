import { useUI } from "@/app/store";
import { queryClient } from "@/app/queries";
import { notifyNew, pollForNotifications } from "@/app/notifications";
import { getPluginValue, setPluginValue } from "@/data/pluginStorage";
import { adfText, mentions, paths, toComment } from "@/lib/jira";
import { jira } from "@/platform/jira";
import { myIssuesQuery } from "./state";
import { CommentsOption, getCommentsFilter } from "./CommentsOption";
import type { PluginNotificationKind } from "../types";

export const JIRA_NOTIFICATIONS: PluginNotificationKind[] = [
  { kind: "assigned", label: "Tickets assigned to you", hint: "When a ticket is newly assigned to you (or reopened)." },
  {
    kind: "comment",
    label: "New comments on your tickets",
    hint: "When someone else comments on an open ticket assigned to you: every comment, or only the ones that mention you.",
    settings: CommentsOption,
  },
];

const short = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const time = (iso: string) => Date.parse(iso) || 0;
/** In the history: the overview with the ticket's panel. */
const ticket = (key: string) => ({ page: "overview", panel: "issue", panelParam: key });

/**
 * Every few minutes (the plugin's `start`, main window): my open tickets, and
 * the comments on the ones that changed since the last check. The list query
 * is the overview's own (cached), so this rarely costs an extra request.
 */
export function startJiraNotifications(): () => void {
  return pollForNotifications(async () => {
    const account = useUI.getState().settings.jiraAccount;
    if (!account) return;
    const { queryKey, queryFn } = myIssuesQuery(account, false);
    const issues = await queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });

    await notifyNew(
      "jira",
      "assigned",
      issues.map((i) => ({ id: i.key, title: `Assigned to you: ${i.key}`, body: i.summary, open: ticket(i.key) })),
      { summary: (n) => ({ title: `${n} tickets assigned to you`, body: "Open Forgor to see them." }) },
    );

    // Comments: only on tickets updated since the last check, and only comments written after it.
    const since = await getPluginValue<string | null>("jira", "notifications.commentsSince", null);
    const now = new Date().toISOString();
    if (since) {
      const onlyMentions = (await getCommentsFilter()) === "mentions";
      const changed = issues.filter((i) => time(i.updated) > time(since)).slice(0, 20);
      const items = [];
      for (const issue of changed) {
        const r = await jira().get<{ comments: { id: string; author?: unknown; created?: string; body?: unknown }[] }>(account, paths.comments(issue.key));
        for (const c of r.comments.map(toComment)) {
          if (c.authorId === account.accountId || time(c.created) <= time(since)) continue;
          const mentioned = mentions(c.body, account.accountId);
          if (onlyMentions && !mentioned) continue;
          const title = mentioned ? `${c.author} mentioned you on ${issue.key}` : `${c.author} commented on ${issue.key}`;
          items.push({ id: `${issue.key}#${c.id}`, title, body: short(adfText(c.body).replace(/\s+/g, " ").trim()) || issue.summary, open: ticket(issue.key) });
        }
      }
      await notifyNew("jira", "comment", items, { baseline: false, summary: (n) => ({ title: onlyMentions ? `${n} new mentions on your tickets` : `${n} new comments on your tickets`, body: "Open Forgor to see them." }) });
    }
    await setPluginValue("jira", "notifications.commentsSince", now);
  });
}
