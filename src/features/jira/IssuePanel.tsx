import { ArrowLeft, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { format } from "date-fns";
import { useUI } from "@/app/store";
import { useFolders } from "@/app/queries";
import { useComments, useIssue, useJiraAccount } from "@/app/jira";
import { issueUrl, type JiraIssue } from "@/lib/jira";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useResizableWidth } from "@/components/ResizeHandle";
import { FolderLabel } from "@/features/folder/folderColors";
import { openExternal } from "@/platform/os";
import { friendlyDate, todayStr } from "@/lib/dates";
import { JiraDoc } from "./JiraDoc";
import { StatusBadge } from "./IssueRow";

const when = (iso: string) => (iso ? format(new Date(iso), "d MMM yyyy, HH:mm") : "");

/** A Jira ticket in the right-hand panel: details, description and comments (read-only). */
export function IssuePanel() {
  const key = useUI((s) => s.selectedIssueKey);
  const fromFolder = useUI((s) => s.issueFromFolder);
  const openIssue = useUI((s) => s.openIssue);
  const account = useJiraAccount();
  const { data: issue, error, isLoading, refetch, isFetching } = useIssue(key);
  const { width, handle } = useResizableWidth("panelWidth", { min: 300, max: 720, edge: "left" });
  if (!key) return null;
  const url = account ? issueUrl(account.site, key) : undefined;

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l bg-background" style={{ width }} data-testid="issue-panel">
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
          <span className="truncate font-mono text-xs text-muted-foreground">{key}</span>
        </div>
        <div className="flex shrink-0 items-center">
          <Tooltip content="Refresh">
            <Button size="icon" variant="ghost" onClick={() => void refetch()} aria-label="Refresh" disabled={isFetching}>
              <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            </Button>
          </Tooltip>
          {url && (
            <Button size="sm" variant="ghost" onClick={() => void openExternal(url)} data-testid="open-in-jira">
              <ExternalLink /> Open in Jira
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => openIssue(null)} aria-label="Close">
            <X />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : error || !issue ? (
          <p className="text-sm text-destructive">{String((error as Error)?.message ?? error ?? "Not found")}</p>
        ) : (
          <IssueBody issue={issue} url={url} />
        )}
      </div>
    </aside>
  );
}

function IssueBody({ issue, url }: { issue: JiraIssue; url?: string }) {
  const { data: comments = [], isLoading } = useComments(issue.key);
  const linkedFolder = useLinkedFolder(issue.project.key);
  const today = todayStr();
  return (
    <>
      <h2 className="text-lg font-semibold leading-snug tracking-tight" data-testid="issue-summary">
        {issue.summary}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge issue={issue} />
        {issue.type && <span className="text-xs text-muted-foreground">{issue.type}</span>}
        {issue.labels.map((l) => (
          <span key={l} className="rounded border px-1.5 text-[11px] text-muted-foreground">
            {l}
          </span>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <Prop label="Project">
          {issue.project.name || issue.project.key}
          {linkedFolder && (
            <button className="ml-2 inline-flex" onClick={() => useUI.getState().openFolder(linkedFolder)} title="Open the linked folder">
              <FolderLabel folderId={linkedFolder} className="text-xs [&_svg]:size-3.5" />
            </button>
          )}
        </Prop>
        <Prop label="Priority">{issue.priority ?? "None"}</Prop>
        <Prop label="Assignee">{issue.assignee ?? "Unassigned"}</Prop>
        <Prop label="Reporter">{issue.reporter ?? "Unknown"}</Prop>
        {issue.due && <Prop label="Due">{friendlyDate(issue.due, today)}</Prop>}
        <Prop label="Created">{when(issue.created)}</Prop>
        <Prop label="Updated">{when(issue.updated)}</Prop>
      </dl>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</h3>
      <div data-testid="issue-description">
        <JiraDoc doc={issue.description} issueUrl={url} attachments={issue.attachments} fallbackInOrder />
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Comments{comments.length > 0 && ` · ${comments.length}`}
      </h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments.</p>
      ) : (
        <ul className="space-y-4" data-testid="issue-comments">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="mb-1 flex items-baseline gap-2 text-xs">
                <span className="font-semibold">{c.author}</span>
                <span className="text-muted-foreground">{when(c.created)}</span>
              </div>
              <JiraDoc doc={c.body} issueUrl={url} attachments={issue.attachments} />
            </li>
          ))}
        </ul>
      )}
    </>
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

/** A folder whose linked board is on this project (to jump there). */
function useLinkedFolder(projectKey: string): string | null {
  const folders = useFoldersWithBoards();
  return folders.find((f) => f.jiraBoard?.projectKey === projectKey)?.id ?? null;
}

function useFoldersWithBoards() {
  const { data: folders = [] } = useFolders();
  return folders.filter((f) => f.jiraBoard);
}
