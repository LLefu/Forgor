import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Settings, SquareKanban, Ticket } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useUI } from "@/app/store";
import { useBoardIssues, useJiraAccount, useMyIssues } from "@/app/jira";
import { filterIssues, sortIssues, SORT_LABELS, type IssueSort, type JiraIssue, type StatusCategory } from "@/lib/jira";
import { PageHeader } from "@/features/todos/TodosPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { IssueRow } from "./IssueRow";

type StatusFilter = "open" | "new" | "indeterminate" | "done" | "all";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "To do" },
  { value: "indeterminate", label: "In progress" },
  { value: "done", label: "Done (last 30 days)" },
  { value: "all", label: "All (incl. done)" },
];

const CATEGORIES: Record<StatusFilter, StatusCategory[]> = {
  open: ["new", "indeterminate"],
  new: ["new"],
  indeterminate: ["indeterminate"],
  done: ["done"],
  all: [],
};

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

/** Main menu → Jira: every ticket assigned to me, with filters and sorting. */
export function JiraOverview() {
  const [status, setStatus] = useStored<StatusFilter>("forgor.jira.status", "open");
  const query = useMyIssues(status === "done" || status === "all");
  return (
    <IssueListPage title="Jira" icon={<Ticket className="size-5 text-muted-foreground" />} query={query} status={status} setStatus={setStatus} storageKey="forgor.jira" showProjects />
  );
}

/** A folder's board → "View all": my tickets on that board. */
export function JiraBoardPage({ boardId, name }: { boardId: number; name: string }) {
  const [status, setStatus] = useStored<StatusFilter>("forgor.jira.board.status", "open");
  const query = useBoardIssues(boardId, status === "done" || status === "all");
  return <IssueListPage title={name} icon={<SquareKanban className="size-5 text-muted-foreground" />} query={query} status={status} setStatus={setStatus} storageKey="forgor.jira.board" />;
}

function IssueListPage({
  title,
  icon,
  query,
  status,
  setStatus,
  storageKey,
  showProjects = false,
}: {
  title: string;
  icon: React.ReactNode;
  query: UseQueryResult<JiraIssue[]>;
  status: StatusFilter;
  setStatus: (s: StatusFilter) => void;
  storageKey: string;
  showProjects?: boolean;
}) {
  const account = useJiraAccount();
  const [sort, setSort] = useStored<IssueSort>(`${storageKey}.sort`, "updated");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState("");
  const [text, setText] = useState("");
  const issues = useMemo(() => query.data ?? [], [query.data]);

  const projects = useMemo(() => [...new Map(issues.map((i) => [i.project.key, i.project.name || i.project.key])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [issues]);
  const priorities = useMemo(() => [...new Set(issues.map((i) => i.priority).filter((p): p is string => !!p))], [issues]);
  const shown = useMemo(
    () => sortIssues(filterIssues(issues, { text, projects: project ? [project] : [], categories: CATEGORIES[status], priorities: priority ? [priority] : [] }), sort),
    [issues, text, project, priority, status, sort],
  );

  if (!account) return <NotConnected />;

  return (
    <div className="mx-auto max-w-3xl pb-16" data-testid="jira-page">
      <PageHeader title={title} icon={icon} subtitle={query.isSuccess ? `${shown.length} ${shown.length === 1 ? "ticket" : "tickets"} assigned to you` : undefined}>
        <Tooltip content="Refresh">
          <Button size="icon" variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh">
            <RefreshCw className={query.isFetching ? "animate-spin" : undefined} />
          </Button>
        </Tooltip>
      </PageHeader>
      <div className="px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="jira-filters">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search key or title" className="pl-7" aria-label="Search tickets" />
          </div>
          <Select<StatusFilter> aria-label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} />
          {showProjects && projects.length > 1 && (
            <Select<string> aria-label="Project" value={project} onChange={setProject} options={[{ value: "", label: "All projects" }, ...projects.map(([key, name]) => ({ value: key, label: name }))]} />
          )}
          {priorities.length > 1 && (
            <Select<string> aria-label="Priority" value={priority} onChange={setPriority} options={[{ value: "", label: "Any priority" }, ...priorities.map((p) => ({ value: p, label: p }))]} />
          )}
          <Select<IssueSort>
            aria-label="Sort by"
            value={sort}
            onChange={setSort}
            options={(Object.keys(SORT_LABELS) as IssueSort[]).map((s) => ({ value: s, label: `Sort: ${SORT_LABELS[s]}` }))}
          />
        </div>

        {query.isLoading ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading tickets…
          </p>
        ) : query.error ? (
          <p className="py-10 text-sm text-destructive">{String((query.error as Error).message ?? query.error)}</p>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{issues.length ? "No tickets match these filters." : "No tickets assigned to you."}</p>
        ) : (
          <div data-testid="jira-list">
            {shown.map((i) => (
              <IssueRow key={i.key} issue={i} showProject={showProjects} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotConnected() {
  const enabled = useUI((s) => s.settings.jiraEnabled);
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Jira" icon={<Ticket className="size-5 text-muted-foreground" />} />
      <div className="mx-8 flex items-center gap-3 rounded border bg-muted/40 p-3 text-sm" data-testid="jira-not-connected">
        <Settings className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">{enabled ? "Connect your Jira account in Settings to see your tickets." : "Turn on the Jira integration in Settings to see your tickets."}</span>
        <Button size="sm" variant="outline" onClick={() => useUI.getState().setView({ kind: "settings" })}>
          Open Settings
        </Button>
      </div>
    </div>
  );
}
