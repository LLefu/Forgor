import { useQueries, useQuery } from "@tanstack/react-query";
import { useUI } from "@/app/store";
import { usePluginEnabled } from "../host";
import { queryClient, useFolders } from "@/app/queries";
import type { Folder } from "@/data/types";
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
  const enabled = usePluginEnabled("jira");
  const account = useUI((s) => s.settings.jiraAccount);
  return enabled ? account : null;
}

const REMOTE = { staleTime: 60_000, refetchOnWindowFocus: true, refetchInterval: 5 * 60_000 } as const;

function get<T>(account: JiraAccount, path: string) {
  return jira().get<T>(account, path);
}

/** A ticket in the right-hand panel (null closes it); `fromFolder` gives the panel a back button. */
export function openIssue(key: string | null, fromFolder: string | null = null) {
  const ui = useUI.getState();
  if (key) ui.openPluginPanel({ plugin: "jira", panel: "issue", param: key, fromFolder });
  else if (ui.pluginPanel?.plugin === "jira") ui.openPluginPanel(null);
}

export async function connectJira(site: string, email: string, token: string) {
  const account = await jira().connect(site, email, token);
  await useUI.getState().updateSetting("jiraAccount", account);
  // Reset, not remove: lists already on screen (the sidebar count) must load again, not stay empty.
  await queryClient.resetQueries({ queryKey: ["jira"] });
  return account;
}

export async function disconnectJira() {
  const { jiraAccount } = useUI.getState().settings;
  if (jiraAccount) await jira().disconnect(jiraAccount);
  await useUI.getState().updateSetting("jiraAccount", null);
  openIssue(null);
  queryClient.removeQueries({ queryKey: ["jira"] });
}

/** Everything assigned to me on the site (open, or also done in the last 30 days). */
export function useMyIssues(withDone: boolean) {
  const account = useJiraAccount();
  return useQuery({ ...myIssuesQuery(account, withDone), enabled: !!account, ...REMOTE });
}

/** The query behind useMyIssues, also fetched by the notification check. */
export function myIssuesQuery(account: JiraAccount | null, withDone: boolean) {
  return {
    queryKey: ["jira", account?.site, "mine", withDone],
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
  };
}

/** What the list pages need of a query (one search, or several boards together). */
export interface IssuesResult {
  data: JiraIssue[] | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

/**
 * My tickets on a folder's boards, together: one request per board (cached per
 * board), merged, a ticket on two boards once, last updated first.
 */
export function useBoardsIssues(boardIds: number[], withDone = false): IssuesResult {
  const account = useJiraAccount();
  return useQueries({
    queries: boardIds.map((id) => ({
      queryKey: ["jira", account?.site, "board", id, withDone],
      enabled: !!account,
      ...REMOTE,
      queryFn: async () => {
        const r = await get<{ issues: { key: string; fields: Record<string, unknown> }[] }>(account!, paths.boardIssues(id, withDone));
        return r.issues.map(toIssue);
      },
    })),
    combine: (results) => {
      const byKey = new Map<string, JiraIssue>();
      for (const r of results) for (const i of r.data ?? []) byKey.set(i.key, i);
      const done = results.every((r) => r.isSuccess);
      return {
        data: done ? [...byKey.values()].sort((a, b) => b.updated.localeCompare(a.updated)) : undefined,
        isLoading: results.some((r) => r.isLoading),
        isSuccess: done,
        isFetching: results.some((r) => r.isFetching),
        error: results.find((r) => r.error)?.error ?? null,
        refetch: () => Promise.all(results.map((r) => r.refetch())),
      };
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

/**
 * Every board I can see (for linking to a folder), page by page: only the
 * first 50 were fetched before, and Jira's own search only matches board
 * names, so a project's board could be missing. Searched with `matchBoards`.
 */
export function useAllBoards(enabled: boolean) {
  const account = useJiraAccount();
  return useQuery({
    queryKey: ["jira", account?.site, "boards"],
    enabled: !!account && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<JiraBoardRef[]> => {
      const boards: JiraBoardRef[] = [];
      for (let page = 0; page < 40; page++) {
        const r = await get<{ values: { id: number; name: string; location?: { projectKey?: string; projectName?: string } }[]; isLast?: boolean }>(
          account!,
          paths.boards(boards.length),
        );
        boards.push(...r.values.map((b) => ({ id: b.id, name: b.name, projectKey: b.location?.projectKey ?? null, projectName: b.location?.projectName ?? null })));
        if (r.isLast !== false || !r.values.length) break;
      }
      return boards;
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

/** The folder with a linked board on this project (the first, if several). */
export function useFolderForProject(projectKey: string): Folder | null {
  const { data: folders = [] } = useFolders();
  return folders.find((f) => f.jiraBoards?.some((b) => b.projectKey === projectKey)) ?? null;
}
