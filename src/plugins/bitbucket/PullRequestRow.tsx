import { useLayoutEffect, useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRight, CheckCircle2, CircleAlert, CircleCheck, CircleSlash, CircleX, Clock, Eye, GitPullRequest, LoaderCircle, MessageSquare } from "lucide-react";
import { useUI } from "@/app/store";
import { Tooltip } from "@/components/ui/tooltip";
import { openExternal } from "@/platform/os";
import { FolderGlyph } from "@/features/folder/folderColors";
import { basename } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { myReview, prRef, summarizeBuilds, type Build, type BuildSummary, type PullRequest, type ReviewState } from "@/lib/bitbucket";
import { openPullRequest, useBitbucketAccount, useBuilds, useFolderForPullRequest } from "./state";

export const ago = (iso: string) => (iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : "");

const REVIEW: Record<ReviewState, { label: string; icon: typeof Clock; cls: string }> = {
  waiting: { label: "Review", icon: Eye, cls: "bg-primary/12 text-primary" },
  approved: { label: "Approved", icon: CheckCircle2, cls: "bg-success/15 text-success" },
  changes_requested: { label: "Changes requested", icon: CircleAlert, cls: "bg-warning/15 text-warning" },
};

/** On a review request: where my review stands ("Review" while I haven't). With `url` it's a button that opens the PR in Bitbucket. */
export function ReviewChip({ state, url, className }: { state: ReviewState; url?: string; className?: string }) {
  const { label, icon: Icon, cls } = REVIEW[state];
  const chip = cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", cls, className);
  if (!url) {
    return (
      <span className={chip} data-testid="pr-review-chip">
        <Icon className="size-3" /> {label}
      </span>
    );
  }
  return (
    <Tooltip content="Open in Bitbucket">
      <button
        className={cn(chip, "cursor-pointer outline-none transition-[filter,box-shadow] hover:brightness-95 hover:ring-1 hover:ring-current/30 focus-visible:ring-2 focus-visible:ring-ring dark:hover:brightness-125")}
        onClick={(e) => {
          e.stopPropagation(); // not the row (it opens the panel)
          void openExternal(url);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={`${label}: open in Bitbucket`}
        data-testid="pr-review-chip"
      >
        <Icon className="size-3" /> {label}
      </button>
    </Tooltip>
  );
}

/** On my own PR: how many reviewers approved. */
export function ApprovalCount({ pr }: { pr: PullRequest }) {
  const approved = pr.reviewers.filter((r) => r.state === "approved").length;
  const changes = pr.reviewers.some((r) => r.state === "changes_requested");
  if (!pr.reviewers.length) return <span className="shrink-0 text-xs text-muted-foreground">No reviewers</span>;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs tabular-nums", changes ? "text-warning" : approved === pr.reviewers.length ? "text-success" : "text-muted-foreground")}
      title={changes ? "Changes requested" : `${approved} of ${pr.reviewers.length} reviewers approved`}
      data-testid="pr-approvals"
    >
      {changes ? <CircleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
      {approved}/{pr.reviewers.length}
    </span>
  );
}

const BUILD: Record<Exclude<BuildSummary, null>, { icon: typeof Clock; cls: string; label: string }> = {
  passed: { icon: CircleCheck, cls: "text-success", label: "Build passed" },
  failed: { icon: CircleX, cls: "text-destructive", label: "Build failed" },
  running: { icon: LoaderCircle, cls: "animate-spin text-warning", label: "Build running" },
  stopped: { icon: CircleSlash, cls: "text-muted-foreground", label: "Build stopped" },
};

/** One build's state as an icon (with `state` of a single build), or all of them summed up. */
export function BuildIcon({ summary, className }: { summary: BuildSummary; className?: string }) {
  if (!summary) return null;
  const { icon: Icon, cls, label } = BUILD[summary];
  return <Icon className={cn("size-3.5 shrink-0", cls, className)} aria-label={label} data-testid="pr-build" data-build={summary} />;
}

export const buildSummary = (b: Build): BuildSummary => ({ SUCCESSFUL: "passed", FAILED: "failed", INPROGRESS: "running", STOPPED: "stopped" } as const)[b.state];

/** On a row: the builds summed up, with each one in the tooltip. Nothing when the repo reports no builds. */
function RowBuilds({ pr }: { pr: PullRequest }) {
  const { data: builds = [] } = useBuilds({ workspace: pr.repo.workspace, slug: pr.repo.slug, id: pr.id });
  const summary = summarizeBuilds(builds);
  if (!summary) return null;
  return (
    <Tooltip content={builds.map((b) => `${b.name}: ${BUILD[buildSummary(b)!].label.replace("Build ", "")}`).join(" · ")}>
      <span className="flex shrink-0">
        <BuildIcon summary={summary} />
      </span>
    </Tooltip>
  );
}

export function DraftChip() {
  return <span className="shrink-0 rounded border px-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">Draft</span>;
}

/**
 * One pull request in a list; clicking opens it on the right. Review requests
 * have an accent bar and where my review stands; mine show the approvals. The
 * left shows the icon of the folder it belongs to (its project).
 */
export function PullRequestRow({ pr, fromFolder = null, iconSlot = false }: { pr: PullRequest; fromFolder?: string | null; iconSlot?: boolean }) {
  const account = useBitbucketAccount();
  const folder = useFolderForPullRequest(pr);
  const ref = prRef(pr);
  const selected = useUI((s) => s.pluginPanel?.plugin === "bitbucket" && s.pluginPanel.param === ref);
  const review = pr.role === "review";
  const open = () => openPullRequest(ref, fromFolder);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className={cn(
        "group relative flex cursor-pointer items-center gap-2.5 rounded py-1.5 pl-3 pr-2 outline-none",
        selected ? "bg-accent" : "hover:bg-muted/70 focus-visible:bg-muted/70",
      )}
      data-testid="pr-row"
      data-ref={ref}
      data-role={pr.role}
    >
      {/* Review requests: an accent bar on the left */}
      <span className={cn("absolute inset-y-1.5 left-0.5 w-0.75 rounded-full", review ? "bg-primary" : "bg-transparent")} />
      {folder?.icon ? (
        <span title={basename(folder.path)} className="flex shrink-0" data-testid="pr-folder-icon">
          <FolderGlyph icon={folder.icon} color={null} className="size-5" />
        </span>
      ) : (
        <span className={cn("flex shrink-0 justify-center", iconSlot && "w-5")}>
          <GitPullRequest className="size-4 text-muted-foreground" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] leading-5">{pr.title}</span>
          {pr.draft && <DraftChip />}
        </div>
        <div className="flex min-w-0 items-center gap-x-3 overflow-hidden text-xs text-muted-foreground">
          <span className="shrink-0 truncate">
            {pr.repo.name} <span className="font-mono">#{pr.id}</span>
          </span>
          <span className="hidden min-w-0 items-center gap-1 truncate font-mono text-[11px] @xl:flex">
            <span className="truncate">{pr.source}</span>
            <ArrowRight className="size-3 shrink-0" />
            <span className="shrink-0">{pr.destination}</span>
          </span>
          {review && <span className="min-w-0 truncate">by {pr.author.name}</span>}
          <span className="shrink-0">{ago(pr.updated)}</span>
          {pr.commentCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums" title={`${pr.commentCount} comments`}>
              <MessageSquare className="size-3" /> {pr.commentCount}
            </span>
          )}
        </div>
      </div>
      <RowBuilds pr={pr} />
      {review ? <ReviewChip state={myReview(pr, account?.uuid ?? "")} url={pr.url} /> : <ApprovalCount pr={pr} />}
    </div>
  );
}

/**
 * A row of options with a highlight that slides to the chosen one (Pull
 * requests → All / Review requested / Mine).
 */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current.get(value);
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    // Counts arriving change the widths.
    const ro = new ResizeObserver(measure);
    for (const el of refs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [value, options]);
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex shrink-0 rounded-md border bg-muted/50 p-0.5" data-testid="pr-filter">
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 rounded bg-background shadow-sm ring-1 ring-border transition-[transform,width] duration-200 ease-out"
          style={{ left: 0, width: pill.width, transform: `translateX(${pill.left}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => {
            if (el) refs.current.set(o.value, el);
            else refs.current.delete(o.value);
          }}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] transition-colors duration-200",
            value === o.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid={`pr-filter-${o.value}`}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular-nums text-xs text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
