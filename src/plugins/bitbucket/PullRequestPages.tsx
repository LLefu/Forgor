import { useMemo, useState } from "react";
import { FolderGit2, GitPullRequest, Loader2, RefreshCw, Search, Settings } from "lucide-react";
import { useFolders } from "@/app/queries";
import { FolderGlyph } from "@/features/folder/folderColors";
import { PageHeader } from "@/features/todos/TodosPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { basename } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { PullRequest } from "@/lib/bitbucket";
import { openPluginSettings } from "../host";
import { useBitbucketAccount, useLinkedRepos, usePullRequests, type PullRequestsResult } from "./state";
import { PullRequestRow, Segmented } from "./PullRequestRow";

type RoleFilter = "all" | "review" | "mine";

/** Remembered per device (like the open tabs). */
function useStored<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  return [
    value,
    (v) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        // ignore
      }
    },
  ];
}

/** Main menu → Pull requests: my open PRs (everywhere) and the ones I'm asked to review (in linked repositories). */
export function PullRequestsOverview() {
  const repos = useLinkedRepos();
  const query = usePullRequests(repos, true);
  return (
    <PullRequestListPage
      title="Pull requests"
      icon={<GitPullRequest className="size-5 text-muted-foreground" />}
      query={query}
      storageKey="forgor.bitbucket"
      hint={repos.length === 0 ? "Review requests come from repositories linked to a folder: link one in a folder's panel." : undefined}
    />
  );
}

/** A folder's repositories → "View all". */
export function PullRequestsFolderPage({ folderId }: { folderId: string }) {
  const { data: folders = [] } = useFolders();
  const folder = folders.find((f) => f.id === folderId);
  const repos = folder?.bitbucketRepos ?? [];
  const query = usePullRequests(repos);
  return (
    <PullRequestListPage
      title={folder ? basename(folder.path) : "Pull requests"}
      subtitle={repos.map((r) => r.name).join(" · ")}
      icon={folder ? <FolderGlyph icon={folder.icon} color={null} className="size-5 text-muted-foreground" /> : <FolderGit2 className="size-5 text-muted-foreground" />}
      query={query}
      storageKey="forgor.bitbucket.folder"
    />
  );
}

function PullRequestListPage({
  title,
  subtitle,
  icon,
  query,
  storageKey,
  hint,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  query: PullRequestsResult;
  storageKey: string;
  hint?: string;
}) {
  const account = useBitbucketAccount();
  const [role, setRole] = useStored<RoleFilter>(`${storageKey}.role`, "all");
  const [text, setText] = useState("");
  const prs = useMemo(() => query.data ?? [], [query.data]);
  const { data: folders = [] } = useFolders();
  const iconSlot = folders.some((f) => f.icon && f.bitbucketRepos?.length);

  const matching = useMemo(() => {
    const q = text.trim().toLowerCase();
    return q ? prs.filter((p) => [p.title, p.repo.name, p.source, p.author.name, `#${p.id}`].some((s) => s.toLowerCase().includes(q))) : prs;
  }, [prs, text]);
  const review = matching.filter((p) => p.role === "review");
  const mine = matching.filter((p) => p.role === "mine");

  if (!account) return <NotConnected />;

  const counted = (n: number) => (query.isSuccess ? n : undefined);
  return (
    <div className="@container mx-auto max-w-3xl pb-16" data-testid="pr-page">
      <PageHeader
        title={title}
        icon={icon}
        subtitle={[subtitle, query.isSuccess ? `${prs.length} open` : null].filter(Boolean).join(" · ") || undefined}
      >
        <Tooltip content="Refresh">
          <Button size="icon" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh">
            <RefreshCw className={query.isFetching ? "animate-spin" : undefined} />
          </Button>
        </Tooltip>
      </PageHeader>
      <div className="px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented<RoleFilter>
            label="Show"
            value={role}
            onChange={setRole}
            options={[
              { value: "all", label: "All", count: counted(matching.length) },
              { value: "review", label: "Review requested", count: counted(review.length) },
              { value: "mine", label: "Mine", count: counted(mine.length) },
            ]}
          />
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search title, repository or branch" className="pl-7" aria-label="Search pull requests" />
          </div>
        </div>

        {hint && <p className="mb-3 text-xs text-muted-foreground">{hint}</p>}
        {query.warning && (
          <p className="mb-3 text-xs text-warning" data-testid="pr-warning">
            Couldn't load your pull requests from other repositories: {query.warning}
          </p>
        )}

        {query.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading pull requests…
          </p>
        ) : query.error ? (
          <p className="py-10 text-sm text-destructive">{String((query.error as Error).message ?? query.error)}</p>
        ) : (
          // Both groups stay mounted, so switching slides and fades instead of jumping.
          <div data-testid="pr-list">
            <Group title="Review requested" prs={review} shown={role !== "mine"} empty="Nobody is waiting for your review." iconSlot={iconSlot} testId="pr-group-review" />
            <Group title="Mine" prs={mine} shown={role !== "review"} empty="You have no open pull requests." iconSlot={iconSlot} testId="pr-group-mine" />
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, prs, shown, empty, iconSlot, testId }: { title: string; prs: PullRequest[]; shown: boolean; empty: string; iconSlot: boolean; testId: string }) {
  return (
    <section
      className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-out", shown ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0")}
      aria-hidden={!shown}
      data-testid={testId}
      data-shown={shown}
    >
      <div className="min-h-0 overflow-hidden">
        <h3 className="mb-1 mt-2 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title} <span className="tabular-nums">{prs.length}</span>
        </h3>
        {prs.length === 0 ? (
          <p className="mb-4 px-2 py-1.5 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="mb-4">
            {prs.map((p) => (
              <PullRequestRow key={`${p.repo.workspace}/${p.repo.slug}/${p.id}`} pr={p} iconSlot={iconSlot} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function NotConnected() {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Pull requests" icon={<GitPullRequest className="size-5 text-muted-foreground" />} />
      <div className="mx-8 flex items-center gap-3 rounded border bg-muted/40 p-3 text-sm" data-testid="bitbucket-not-connected">
        <Settings className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Connect your Bitbucket account to see your pull requests.</span>
        <Button size="sm" variant="outline" onClick={() => openPluginSettings("bitbucket")}>
          Connect
        </Button>
      </div>
    </div>
  );
}
