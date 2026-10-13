import { useQuery } from "@tanstack/react-query";
import { useUI } from "./store";
import { queryClient } from "./queries";
import { jira, type JiraAccount } from "@/platform/jira";
import { MY_OPEN_JQL, MY_RECENT_JQL, paths, toComment, toIssue, type JiraBoardRef, type JiraComment, type JiraIssue } from "@/lib/jira";

/**
 * Jira at runtime: the connected account and the queries. Jira is remote, so
 * its queries are left out of the "refresh everything on every local change"
 * rule (app/queries.ts); they refresh after a minute, on window focus and
 * every few minutes instead.
 */

/** The account, when the integration is on and connected. */
export function useJiraAccount(): JiraAccount | null {
  const enabled = useUI((s) => s.settings.jiraEnabled);
  const account = useUI((s) => s.settings.jiraAccount);
  return enabled ? account : null;
}

const REMOTE = { staleTime: 60_000, refetchOnWindowFocus: true, refetchInterval: 5 * 60_000 } as const;

function get<T>(account: JiraAccount, path: string) {
  return jira().get<T>(account, path);
}

export async function connectJira(site: string, email: string, token: string) {
  const account = await jira().connect(site, email, token);
  await useUI.getState().updateSetting("jiraAccount", account);
  queryClient.removeQueries({ queryKey: ["jira"] });
  return account;
}

export async function disconnectJira() {
  const { jiraAccount } = useUI.getState().settings;
  if (jiraAccount) await jira().disconnect(jiraAccount);
  await useUI.getState().updateSetting("jiraAccount", null);
  useUI.getState().openIssue(null);
  queryClient.removeQueries({ queryKey: ["jira"] });
}

/** Everything assigned to me on the site (open, or also done in the last 30 days). */
export function useMyIssues(withDone: boolean) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "mine", withDone],
    enabled: !!account,
    ...REMOTE,
    queryFn: async () => {
      const issues: JiraIssue[] = [];
      let token: string | undefined;
      // Up to 500; the search pages with a token.
      for (let page = 0; page < 5; page++) {
        const r = await get<{ issues: { key: string; fields: Record<string, unknown> }[]; nextPageToken?: string; isLast?: boolean }>(
          account!,
          paths.search(withDone ? MY_RECENT_JQL : MY_OPEN_JQL, token),
        );
        issues.push(...r.issues.map(toIssue));
        token = r.nextPageToken;
        if (!token || r.isLast) break;
      }
      return issues;
    },
  });
}

/** My tickets on one board. */
export function useBoardIssues(boardId: number | null, withDone = false) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "board", boardId, withDone],
    enabled: !!account && boardId !== null,
    ...REMOTE,
    queryFn: async () => {
      const r = await get<{ issues: { key: string; fields: Record<string, unknown> }[] }>(account!, paths.boardIssues(boardId!, withDone));
      return r.issues.map(toIssue);
    },
  });
}

export function useIssue(key: string | null) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "issue", key],
    enabled: !!account && !!key,
    ...REMOTE,
    queryFn: async () => toIssue(await get(account!, paths.issue(key!))),
  });
}

export function useComments(key: string | null) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "comments", key],
    enabled: !!account && !!key,
    ...REMOTE,
    queryFn: async (): Promise<JiraComment[]> => {
      const r = await get<{ comments: { id: string; author?: unknown; created?: string; body?: unknown }[] }>(account!, paths.comments(key!));
      return r.comments.map(toComment);
    },
  });
}

/** Boards whose name contains `name` (for linking one to a folder). */
export function useBoards(name: string, enabled: boolean) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "boards", name.trim()],
    enabled: !!account && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<JiraBoardRef[]> => {
      const r = await get<{ values: { id: number; name: string; location?: { projectKey?: string; projectName?: string } }[] }>(account!, paths.boards(name));
      return r.values.map((b) => ({ id: b.id, name: b.name, projectKey: b.location?.projectKey ?? null, projectName: b.location?.projectName ?? null }));
    },
  });
}

/** An attachment as an object URL (fetched once per session; attachments don't change). */
export function useAttachmentUrl(id: string | null, mimeType: string) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "attachment", id],
    enabled: !!account && !!id,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    queryFn: async () => URL.createObjectURL(new Blob([await jira().attachment(account!, id!)], { type: mimeType })),
  });
}
