import { useLayoutEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Clock, ExternalLink, GitBranch, Loader2, RefreshCw, Ticket, X } from "lucide-react";
import { useUI } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useResizableWidth } from "@/components/ResizeHandle";
import { FolderLabel } from "@/features/folder/folderColors";
import { openExternal } from "@/platform/os";
import { cn } from "@/lib/utils";
import { jiraKeys, myReview, parsePrRef, plainDescription, type PullRequest, type ReviewState } from "@/lib/bitbucket";
import { usePluginEnabled } from "../host";
import { openPullRequest, useBitbucketAccount, useBuilds, useDiffStat, useFolderForPullRequest, usePullRequest } from "./state";
import { BuildIcon, DraftChip, ReviewChip, ago, buildSummary } from "./PullRequestRow";

const when = (iso: string) => (iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "");

/** A pull request in the right-hand panel: what it is, who reviews, how big, the description (read-only). */
export function PullRequestPanel({ param, fromFolder }: { param: string; fromFolder: string | null }) {
  const ref = parsePrRef(param);
  const { data: pr, error, isLoading, refetch, isFetching } = usePullRequest(ref);
  const { width, handle } = useResizableWidth("panelWidth", { min: 300, max: 720, edge: "left" });
  if (!ref) return null;

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l bg-background" style={{ width }} data-testid="pr-panel">
      {handle}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-center gap-1">
          {fromFolder && (
            <Tooltip content="Back to the folder">
              <Button size="icon" variant="ghost" onClick={() => useUI.getState().openFolder(fromFolder)} aria-label="Back to the folder">
                <ArrowLeft />
              </Button>
            </Tooltip>
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">
            {ref.slug} #{ref.id}
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <Tooltip content="Refresh">
            <Button size="icon" variant="ghost" onClick={() => void refetch()} aria-label="Refresh" disabled={isFetching}>
              <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            </Button>
          </Tooltip>
          {pr && (
            <Button size="sm" variant="ghost" onClick={() => void openExternal(pr.url)} data-testid="open-in-bitbucket">
              <ExternalLink /> Open in Bitbucket
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => openPullRequest(null)} aria-label="Close">
            <X />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : error || !pr ? (
          <p className="text-sm text-destructive">{String((error as Error)?.message ?? error ?? "Not found")}</p>
        ) : (
          <PullRequestBody pr={pr} />
        )}
      </div>
    </aside>
  );
}

const STATE_ICON: Record<ReviewState, { icon: typeof Clock; cls: string; label: string }> = {
  approved: { icon: CheckCircle2, cls: "text-success", label: "Approved" },
  changes_requested: { icon: CircleAlert, cls: "text-warning", label: "Changes requested" },
  waiting: { icon: Clock, cls: "text-muted-foreground", label: "Not reviewed yet" },
};

function PullRequestBody({ pr }: { pr: PullRequest }) {
  const account = useBitbucketAccount();
  const ref = { workspace: pr.repo.workspace, slug: pr.repo.slug, id: pr.id };
  const { data: diff, isLoading: diffLoading, error: diffError } = useDiffStat(ref);
  const { data: builds = [] } = useBuilds(ref);
  const folder = useFolderForPullRequest(pr);
  // Clickable when Jira is on and connected (its panel shows the ticket).
  const jiraEnabled = usePluginEnabled("jira");
  const jiraConnected = useUI((s) => !!s.settings.jiraAccount);
  const jiraOn = jiraEnabled && jiraConnected;
  const keys = jiraKeys(pr);
  return (
    <>
      <h2 className="text-lg font-semibold leading-snug tracking-tight" data-testid="pr-title">
        {pr.title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {pr.role === "review" ? (
          <ReviewChip state={myReview(pr, account?.uuid ?? "")} />
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Yours</span>
        )}
        {pr.draft && <DraftChip />}
      </div>

      {/* source → destination */}
      <div className="mt-3 flex min-w-0 items-center gap-1.5 rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs" data-testid="pr-branches">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate" title={pr.source}>
          {pr.source}
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate" title={pr.destination}>
          {pr.destination}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <Prop label="Repository">
          {pr.repo.name}
          {folder && (
            <button className="ml-2 inline-flex" onClick={() => useUI.getState().openFolder(folder.id)} title="Open the linked folder">
              <FolderLabel folderId={folder.id} className="text-xs [&_svg]:size-3.5" />
            </button>
          )}
        </Prop>
        <Prop label="Author">{pr.author.name}</Prop>
        <Prop label="Reviewers">
          {pr.reviewers.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <ul className="space-y-0.5" data-testid="pr-reviewers">
              {pr.reviewers.map((r) => {
                const s = STATE_ICON[r.state];
                return (
                  <li key={r.person.uuid} className="flex min-w-0 items-center gap-1.5" title={s.label} data-state={r.state}>
                    <s.icon className={cn("size-3.5 shrink-0", s.cls)} aria-label={s.label} />
                    <span className="truncate">
                      {r.person.name}
                      {r.person.uuid === account?.uuid && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Prop>
        <Prop label="Comments">
          <span data-testid="pr-comments">{pr.commentCount}</span>
          {pr.taskCount > 0 && <span className="text-muted-foreground"> · {pr.taskCount} open {pr.taskCount === 1 ? "task" : "tasks"}</span>}
        </Prop>
        <Prop label="Files changed">
          {diffLoading ? (
            <span className="text-muted-foreground">…</span>
          ) : diffError || !diff ? (
            <span className="text-muted-foreground">Unknown</span>
          ) : (
            <span className="tabular-nums" data-testid="pr-files">
              {diff.files} {diff.files === 1 ? "file" : "files"} <span className="text-success">+{diff.added}</span> <span className="text-destructive">−{diff.removed}</span>
            </span>
          )}
        </Prop>
        {builds.length > 0 && (
          <Prop label="Builds">
            <ul className="space-y-0.5" data-testid="pr-builds">
              {builds.map((b) => (
                <li key={b.key} className="flex min-w-0 items-center gap-1.5">
                  <BuildIcon summary={buildSummary(b)} />
                  {b.url ? (
                    <button className="min-w-0 truncate text-left hover:underline" onClick={() => void openExternal(b.url)} title="Open the build">
                      {b.name}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate">{b.name}</span>
                  )}
                </li>
              ))}
            </ul>
          </Prop>
        )}
        {keys.length > 0 && (
          <Prop label={keys.length === 1 ? "Ticket" : "Tickets"}>
            <span className="flex flex-wrap gap-1.5" data-testid="pr-tickets">
              {keys.map((k) =>
                jiraOn ? (
                  <button
                    key={k}
                    className="inline-flex items-center gap-1 rounded border px-1.5 font-mono text-xs hover:bg-muted"
                    onClick={() => useUI.getState().openPluginPanel({ plugin: "jira", panel: "issue", param: k, fromFolder: null })}
                    title="Open the ticket"
                  >
                    <Ticket className="size-3 text-muted-foreground" /> {k}
                  </button>
                ) : (
                  <span key={k} className="font-mono text-xs">
                    {k}
                  </span>
                ),
              )}
            </span>
          </Prop>
        )}
        <Prop label="Created">{when(pr.created)}</Prop>
        <Prop label="Updated">
          {when(pr.updated)} <span className="text-muted-foreground">({ago(pr.updated)})</span>
        </Prop>
      </dl>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
      <Description text={plainDescription(pr.description)} />
    </>
  );
}

/** At most a few lines; "Show more" when there's more. */
function Description({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  if (!text) return <p className="text-sm text-muted-foreground">No description.</p>;
  return (
    <div data-testid="pr-description">
      <div ref={ref} className={cn("whitespace-pre-wrap break-words text-[13px] leading-relaxed", !open && "line-clamp-6")}>
        {text}
      </div>
      {(long || open) && (
        <button className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(!open)} data-testid="pr-description-toggle">
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
