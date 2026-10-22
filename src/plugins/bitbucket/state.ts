import { useQueries, useQuery } from "@tanstack/react-query";
import { useUI } from "@/app/store";
import { queryClient, useFolders } from "@/app/queries";
import type { Folder } from "@/data/types";
import { bitbucket, type BitbucketAccount } from "@/platform/bitbucket";
import {
  jiraKeys,
  mergePullRequests,
  nextPath,
  paths,
  sameRepo,
  sumDiffstat,
  toBuilds,
  toPullRequest,
  type BitbucketRepoRef,
  type Build,
  type DiffStat,
  type PullRequest,
} from "@/lib/bitbucket";
import { usePluginEnabled } from "../host";

/**
 * Bitbucket at runtime: the connected account and the queries. Like Jira's,
 * they're remote: left out of "refresh everything on every local change"
 * (app/queries.ts), refreshed after a minute, on window focus and every few
 * minutes instead. Only open pull requests, only mine or ones I review.
 */

/** The account, when the plugin is on and connected. */
export function useBitbucketAccount(): BitbucketAccount | null {
  const enabled = usePluginEnabled("bitbucket");
  const account = useUI((s) => s.settings.bitbucketAccount);
  return enabled ? account : null;
}

const REMOTE = { staleTime: 60_000, refetchOnWindowFocus: true, refetchInterval: 5 * 60_000 } as const;

const get = <T,>(account: BitbucketAccount, path: string) => bitbucket().get<T>(account, path);

type Page = { values?: unknown[]; next?: string };

/** Every page of a list (up to `max` pages). */
async function all(account: BitbucketAccount, path: string, max = 10): Promise<unknown[]> {
  const out: unknown[] = [];
  let next: string | null = path;
  for (let i = 0; next && i < max; i++) {
    const page: Page = await get<Page>(account, next);
    out.push(...(page.values ?? []));
    next = nextPath(page.next);
  }
  return out;
}

/** A pull request in the right-hand panel (null closes it); `fromFolder` gives the panel a back button. */
export function openPullRequest(ref: string | null, fromFolder: string | null = null) {
  const ui = useUI.getState();
  if (ref) ui.openPluginPanel({ plugin: "bitbucket", panel: "pr", param: ref, fromFolder });
  else if (ui.pluginPanel?.plugin === "bitbucket") ui.openPluginPanel(null);
}

export async function connectBitbucket(email: string, token: string) {
  const account = await bitbucket().connect(email, token);
  await useUI.getState().updateSetting("bitbucketAccount", account);
  // Reset, not remove: lists already on screen (the sidebar count) must load again, not stay empty.
  await queryClient.resetQueries({ queryKey: ["bitbucket"] });
  return account;
}

export async function disconnectBitbucket() {
  const { bitbucketAccount } = useUI.getState().settings;
  if (bitbucketAccount) await bitbucket().disconnect(bitbucketAccount);
  await useUI.getState().updateSetting("bitbucketAccount", null);
  openPullRequest(null);
  queryClient.removeQueries({ queryKey: ["bitbucket"] });
}

export interface PullRequestsResult {
  data: PullRequest[] | undefined;
  /** My PRs from other repositories couldn't be loaded (the rest still shows). */
  warning: string | null;
  isLoading: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

/**
 * Open pull requests I opened or review, in these repositories (one request
 * each, cached per repo), plus with `withMine` my own in every repository
 * (Bitbucket can list those for a user, not the ones to review).
 */
export function usePullRequests(repos: BitbucketRepoRef[], withMine = false): PullRequestsResult {
  const account = useBitbucketAccount();
  const me = account?.uuid ?? "";
  const repoQueries = repos.map((r) => ({ ...repoPullRequestsQuery(account, r), enabled: !!account, ...REMOTE }));
  // Mine everywhere: per workspace (Bitbucket has no list across workspaces any more). Extra, so a failure is a warning, not an error.
  const mineQuery = {
    queryKey: ["bitbucket", me, "mine"],
    enabled: !!account && withMine,
    ...REMOTE,
    queryFn: async () => {
      const prs: PullRequest[] = [];
      for (const ws of await workspaces(account!)) prs.push(...(await all(account!, paths.myPullRequests(ws, me), 4)).map((x) => toPullRequest(x, me)));
      return prs;
    },
  };
  const n = repoQueries.length;
  return useQueries({
    queries: withMine ? [...repoQueries, mineQuery] : repoQueries,
    combine: (results) => {
      const repos = results.slice(0, n);
      const mine = withMine ? results[n] : undefined;
      const done = repos.every((r) => r.isSuccess) && (!mine || mine.isSuccess || mine.isError);
      return {
        data: done ? mergePullRequests(results.map((r) => r.data ?? [])) : undefined,
        warning: mine?.error ? String((mine.error as Error).message ?? mine.error) : null,
        isLoading: results.some((r) => r.isLoading),
        isSuccess: done,
        isFetching: results.some((r) => r.isFetching),
        error: repos.find((r) => r.error)?.error ?? null,
        refetch: () => Promise.all(results.map((r) => r.refetch())),
      };
    },
  });
}

/** One repository's open PRs that I opened or review (also fetched by the notification check). */
export function repoPullRequestsQuery(account: BitbucketAccount | null, r: BitbucketRepoRef) {
  const me = account?.uuid ?? "";
  return {
    queryKey: ["bitbucket", me, "repo", r.workspace, r.slug],
    queryFn: async () => (await all(account!, paths.repoPullRequests(r, me), 4)).map((x) => toPullRequest(x, me)),
  };
}

/** Every repository linked to some folder (for the overview). */
export function useLinkedRepos(): BitbucketRepoRef[] {
  const { data: folders = [] } = useFolders();
  const repos: BitbucketRepoRef[] = [];
  for (const f of folders) for (const r of f.bitbucketRepos ?? []) if (!repos.some((x) => sameRepo(x, r))) repos.push(r);
  return repos;
}

export function usePullRequest(ref: { workspace: string; slug: string; id: number } | null) {
  const account = useBitbucketAccount();
  return useQuery({
    queryKey: ["bitbucket", account?.uuid, "pr", ref?.workspace, ref?.slug, ref?.id],
    enabled: !!account && !!ref,
    ...REMOTE,
    queryFn: async () => toPullRequest(await get(account!, paths.pullRequest(ref!.workspace, ref!.slug, ref!.id)), account!.uuid),
  });
}

type PrId = { workspace: string; slug: string; id: number };

function buildsQuery(account: BitbucketAccount | null, ref: PrId | null) {
  return {
    queryKey: ["bitbucket", account?.uuid, "builds", ref?.workspace, ref?.slug, ref?.id],
    enabled: !!account && !!ref,
    ...REMOTE,
    queryFn: async (): Promise<Build[]> => toBuilds(await all(account!, paths.statuses(ref!.workspace, ref!.slug, ref!.id), 2)),
  };
}

/** The PR's builds (pipelines/CI). Also for list rows, so cached like the lists. */
export function useBuilds(ref: PrId | null) {
  const account = useBitbucketAccount();
  return useQuery(buildsQuery(account, ref));
}

/** The builds of several PRs (the rows' own queries), in the same order. */
export function useBuildsOf(prs: PullRequest[]): (Build[] | undefined)[] {
  const account = useBitbucketAccount();
  return useQueries({
    queries: prs.map((p) => buildsQuery(account, { workspace: p.repo.workspace, slug: p.repo.slug, id: p.id })),
    combine: (results) => results.map((r) => r.data),
  });
}

export function useDiffStat(ref: { workspace: string; slug: string; id: number } | null) {
  const account = useBitbucketAccount();
  return useQuery({
    queryKey: ["bitbucket", account?.uuid, "diffstat", ref?.workspace, ref?.slug, ref?.id],
    enabled: !!account && !!ref,
    ...REMOTE,
    queryFn: async (): Promise<DiffStat> => sumDiffstat((await all(account!, paths.diffstat(ref!.workspace, ref!.slug, ref!.id))) as { lines_added?: number; lines_removed?: number }[]),
  });
}

/** The slugs of my workspaces. */
async function workspaces(account: BitbucketAccount): Promise<string[]> {
  const list = (await all(account, paths.workspaces())).map((w) => {
    const x = w as { workspace?: { slug?: string }; slug?: string };
    return x.workspace?.slug ?? x.slug ?? "";
  });
  return [...new Set(list.filter(Boolean))];
}

/** Every repository I'm a member of, in all my workspaces (for linking to a folder). */
export function useAllRepos(enabled: boolean) {
  const account = useBitbucketAccount();
  return useQuery({
    queryKey: ["bitbucket", account?.uuid, "repos"],
    enabled: !!account && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BitbucketRepoRef[]> => {
      const repos: BitbucketRepoRef[] = [];
      for (const ws of await workspaces(account!)) {
        for (const r of await all(account!, paths.repos(ws))) {
          const x = r as { slug?: string; name?: string; full_name?: string };
          const slug = x.slug ?? x.full_name?.split("/")[1] ?? "";
          if (slug) repos.push({ workspace: ws, slug, name: x.name || slug });
        }
      }
      return repos.sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/**
 * The folder a pull request belongs to: the one its repository is linked to,
 * else one whose Jira board is on the project of a ticket key in its title or
 * branch. Its icon is the PR's "project icon".
 */
export function useFolderForPullRequest(pr: PullRequest | undefined): Folder | null {
  const { data: folders = [] } = useFolders();
  if (!pr) return null;
  const byRepo = folders.find((f) => f.bitbucketRepos?.some((r) => sameRepo(r, pr.repo)));
  if (byRepo) return byRepo;
  const projects = jiraKeys(pr).map((k) => k.split("-")[0]);
  return folders.find((f) => f.jiraBoards?.some((b) => b.projectKey && projects.includes(b.projectKey))) ?? null;
}
