import { useUI } from "@/app/store";
import { priorityRank, type JiraIssue, type StatusCategory } from "@/lib/jira";
import { friendlyDate, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

const STATUS_CLS: Record<StatusCategory, string> = {
  new: "bg-muted text-muted-foreground",
  indeterminate: "bg-primary/12 text-primary",
  done: "bg-success/15 text-success",
};

export function StatusBadge({ issue, className }: { issue: Pick<JiraIssue, "status" | "statusCategory">; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", STATUS_CLS[issue.statusCategory], className)} data-testid="issue-status">
      {issue.status}
    </span>
  );
}

const PRIORITY_VAR = ["var(--p4)", "var(--p4)", "var(--p4)", "var(--p3)", "var(--p2)", "var(--p1)"];

/** A coloured bar like Forgor's own priorities: Highest/High red/yellow, Medium blue, Low grey. */
export function PriorityMark({ priority }: { priority: string | null }) {
  if (!priority) return <span className="w-1 shrink-0" />;
  return <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: PRIORITY_VAR[priorityRank(priority)] }} title={`Priority: ${priority}`} aria-label={`Priority: ${priority}`} />;
}

/** One ticket in a list; clicking opens it in the right-hand panel. */
export function IssueRow({ issue, fromFolder = null, showProject = false }: { issue: JiraIssue; fromFolder?: string | null; showProject?: boolean }) {
  const openIssue = useUI((s) => s.openIssue);
  const selected = useUI((s) => s.selectedIssueKey === issue.key);
  const today = todayStr();
  const done = issue.statusCategory === "done";
  const overdue = !!issue.due && issue.due < today && !done;
  const open = () => openIssue(issue.key, fromFolder);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className={cn("group flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 outline-none", selected ? "bg-accent" : "hover:bg-muted/70 focus-visible:bg-muted/70")}
      data-testid="issue-row"
      data-key={issue.key}
    >
      <PriorityMark priority={issue.priority} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13.5px] leading-5", done && "text-muted-foreground line-through")}>{issue.summary}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{issue.key}</span>
          {issue.type && <span>{issue.type}</span>}
          {showProject && issue.project.name && <span className="truncate">{issue.project.name}</span>}
          {issue.due && <span className={cn(overdue && "text-destructive")}>due {friendlyDate(issue.due, today)}</span>}
        </div>
      </div>
      <StatusBadge issue={issue} />
    </div>
  );
}
