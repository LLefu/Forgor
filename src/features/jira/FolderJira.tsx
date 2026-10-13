import { useState } from "react";
import { ChevronRight, Loader2, Plus, SquareKanban, X } from "lucide-react";
import { useUI } from "@/app/store";
import { useAllBoards, useBoardsIssues, useJiraAccount } from "@/app/jira";
import { setFolderJiraBoards } from "@/data/notes";
import type { Folder } from "@/data/types";
import { matchBoards, type JiraBoardRef } from "@/lib/jira";
import { Section } from "@/features/todos/TodosPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { IssueRow } from "./IssueRow";

/** In the folder panel, below the notes: the folder's Jira boards and my tickets on them (together). */
export function FolderJira({ folder }: { folder: Folder }) {
  const enabled = useUI((s) => s.settings.jiraEnabled);
  const account = useJiraAccount();
  if (!enabled) return null;
  if (!account) {
    return (
      <Section title="Jira">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          <button className="underline underline-offset-2 hover:text-foreground" onClick={() => useUI.getState().setView({ kind: "settings" })}>
            Connect your Jira account
          </button>{" "}
          to link a board to this folder.
        </p>
      </Section>
    );
  }
  return <FolderBoards folder={folder} boards={folder.jiraBoards ?? []} />;
}

/** Shown in the folder; the rest is behind "View all". */
const PREVIEW = 8;

function FolderBoards({ folder, boards }: { folder: Folder; boards: JiraBoardRef[] }) {
  const { data: issues = [], isLoading, error } = useBoardsIssues(boards.map((b) => b.id));
  // Inline, not a popover: a popover opened from a menu closed again right away (the closing menu took the focus).
  const [adding, setAdding] = useState(false);
  const linked = boards.length > 0;
  const add = (b: JiraBoardRef) => void setFolderJiraBoards(folder.id, [...boards.filter((x) => x.id !== b.id), b]).then(() => setAdding(false));
  const remove = (b: JiraBoardRef) => void setFolderJiraBoards(folder.id, boards.filter((x) => x.id !== b.id));

  return (
    <div data-testid="folder-jira">
      <Section title="Jira" count={linked && !isLoading ? issues.length : undefined}>
        {/* The linked boards, each with × to unlink, and + to add one */}
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5 pt-0.5">
          {boards.map((b) => (
            <span key={b.id} className="inline-flex max-w-full items-center gap-1 rounded border py-0.5 pl-1.5 pr-0.5 text-xs" data-testid="jira-board-chip">
              <SquareKanban className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{b.name}</span>
              <Tooltip content="Unlink this board">
                <button className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => remove(b)} aria-label={`Unlink ${b.name}`}>
                  <X className="size-3" />
                </button>
              </Tooltip>
            </span>
          ))}
          {!adding && (
            <Button variant={linked ? "ghost" : "outline"} size="sm" className="h-6 px-1.5 text-xs" onClick={() => setAdding(true)} data-testid="jira-link-board">
              <Plus /> {linked ? "Add board" : "Link a Jira board"}
            </Button>
          )}
        </div>
        {adding && (
          <div className="px-1 pb-2">
            <BoardList onPick={add} onCancel={() => setAdding(false)} exclude={boards.map((b) => b.id)} />
          </div>
        )}

        {!linked ? (
          !adding && <p className="px-2 text-xs text-muted-foreground">Shows the tickets assigned to you on the folder's boards here.</p>
        ) : isLoading ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading tickets…
          </p>
        ) : error ? (
          <p className="px-2 py-1.5 text-xs text-destructive">{String((error as Error).message ?? error)}</p>
        ) : issues.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No open tickets assigned to you on {boards.length === 1 ? "this board" : "these boards"}.</p>
        ) : (
          issues.slice(0, PREVIEW).map((i) => <IssueRow key={i.key} issue={i} fromFolder={folder.id} />)
        )}
        {linked && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-xs text-muted-foreground"
            onClick={() => useUI.getState().setView({ kind: "jira-folder", folderId: folder.id })}
            data-testid="jira-view-all"
          >
            View all{issues.length > PREVIEW ? ` (${issues.length})` : ""} <ChevronRight />
          </Button>
        )}
      </Section>
    </div>
  );
}

/** Search and pick a board; × or Esc cancels. */
function BoardList({ onPick, onCancel, exclude }: { onPick: (b: JiraBoardRef) => void; onCancel: () => void; exclude: number[] }) {
  const [name, setName] = useState("");
  const { data = [], isLoading, error } = useAllBoards(true);
  const matches = matchBoards(data, name);
  const boards = matches.filter((b) => !exclude.includes(b.id));
  return (
    <div data-testid="jira-board-picker">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation(); // not the panel too
              onCancel();
            }
          }}
          placeholder="Search by board or project"
          aria-label="Search boards"
        />
        <Tooltip content="Cancel (Esc)">
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onCancel} aria-label="Cancel" data-testid="jira-board-cancel">
            <X />
          </Button>
        </Tooltip>
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {isLoading ? (
          <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading boards…
          </p>
        ) : error ? (
          <p className="px-2 py-2 text-xs text-destructive">{String((error as Error).message ?? error)}</p>
        ) : boards.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{matches.length ? "Those boards are already linked to this folder." : data.length ? "No board matches that name or project." : "No boards found."}</p>
        ) : (
          boards.map((b) => (
            <button key={b.id} onClick={() => onPick(b)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted" data-testid="jira-board-option">
              <SquareKanban className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.projectName && <span className="shrink-0 truncate text-xs text-muted-foreground">{b.projectName}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
