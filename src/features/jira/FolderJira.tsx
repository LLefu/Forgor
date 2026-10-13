import { useState } from "react";
import { ChevronRight, Link2, Loader2, MoreHorizontal, SquareKanban, Unlink } from "lucide-react";
import { useUI } from "@/app/store";
import { useBoardIssues, useBoards, useJiraAccount } from "@/app/jira";
import { setFolderJiraBoard } from "@/data/notes";
import type { Folder } from "@/data/types";
import type { JiraBoardRef } from "@/lib/jira";
import { Section } from "@/features/todos/TodosPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { IssueRow } from "./IssueRow";

/** In the folder panel, below the notes: link a Jira board, then my tickets on it. */
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
  return folder.jiraBoard ? <LinkedBoard folder={folder} board={folder.jiraBoard} /> : <BoardPicker folderId={folder.id} />;
}

/** Shown in the folder; the rest is behind "View all". */
const PREVIEW = 8;

function LinkedBoard({ folder, board }: { folder: Folder; board: JiraBoardRef }) {
  const { data: issues = [], isLoading, error } = useBoardIssues(board.id);
  // The count is part of the heading here, with room on the right for the "…" menu.
  const heading = (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 pr-6">
      <SquareKanban className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">Jira · {board.name}</span>
      {!isLoading && <span className="font-normal text-muted-foreground">{issues.length}</span>}
    </span>
  );
  return (
    <div className="relative" data-testid="folder-jira">
      <Section title="Jira" heading={heading}>
        {isLoading ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading tickets…
          </p>
        ) : error ? (
          <p className="px-2 py-1.5 text-xs text-destructive">{String((error as Error).message ?? error)}</p>
        ) : issues.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No open tickets assigned to you on this board.</p>
        ) : (
          issues.slice(0, PREVIEW).map((i) => <IssueRow key={i.key} issue={i} fromFolder={folder.id} />)
        )}
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 text-xs text-muted-foreground"
          onClick={() => useUI.getState().setView({ kind: "jira-board", boardId: board.id, name: board.name })}
          data-testid="jira-view-all"
        >
          View all{issues.length > PREVIEW ? ` (${issues.length})` : ""} <ChevronRight />
        </Button>
      </Section>
      <BoardMenu folderId={folder.id} />
    </div>
  );
}

/** "…" next to the heading: change or unlink the board. */
function BoardMenu({ folderId }: { folderId: string }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="absolute right-0 top-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground" aria-label="Jira board options" data-testid="jira-board-menu">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPicking(true)}>
            <Link2 /> Link another board
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void setFolderJiraBoard(folderId, null)}>
            <Unlink /> Unlink board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {picking && <BoardSearch onPick={(b) => void setFolderJiraBoard(folderId, b).then(() => setPicking(false))} onClose={() => setPicking(false)} anchorless />}
    </div>
  );
}

function BoardPicker({ folderId }: { folderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Jira">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="mx-2 my-1" data-testid="jira-link-board">
            <SquareKanban /> Link a Jira board
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2">
          <BoardList onPick={(b) => void setFolderJiraBoard(folderId, b).then(() => setOpen(false))} />
        </PopoverContent>
      </Popover>
      <p className="px-2 text-xs text-muted-foreground">Shows the tickets assigned to you on that board here.</p>
    </Section>
  );
}

/** A board picker without a trigger (from the "…" menu): a small dialog-like popover. */
function BoardSearch({ onPick, onClose, anchorless }: { onPick: (b: JiraBoardRef) => void; onClose: () => void; anchorless?: boolean }) {
  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverTrigger asChild>
        <span className={anchorless ? "absolute right-0 top-5" : undefined} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <BoardList onPick={onPick} />
      </PopoverContent>
    </Popover>
  );
}

function BoardList({ onPick }: { onPick: (b: JiraBoardRef) => void }) {
  const [name, setName] = useState("");
  const { data: boards = [], isLoading, error } = useBoards(name, true);
  return (
    <div data-testid="jira-board-picker">
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Search boards" aria-label="Search boards" />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {isLoading ? (
          <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading boards…
          </p>
        ) : error ? (
          <p className="px-2 py-2 text-xs text-destructive">{String((error as Error).message ?? error)}</p>
        ) : boards.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No boards found.</p>
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
