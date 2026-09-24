import { useMemo, useRef } from "react";
import type { TreeApi } from "react-arborist";
import {
  Inbox,
  CalendarDays,
  CalendarClock,
  Sun,
  Search,
  Archive,
  Trash2,
  Settings,
  FilePlus,
  FolderPlus,
  ChevronsDownUp,
  Plus,
  Moon,
  Monitor,
} from "lucide-react";
import { useUI, type View } from "./store";
import { useUpdates } from "./updates";
import { Download } from "lucide-react";
import { useTodos } from "./queries";
import { Explorer, type TreeItem } from "@/features/explorer/Explorer";
import { bucketTodos, isOpen, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import * as notes from "@/data/notes";
import { dirname } from "@/lib/paths";
import { shortcutLabel } from "@/lib/keys";

export function Sidebar() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const settings = useUI((s) => s.settings);
  const updateSetting = useUI((s) => s.updateSetting);
  const { data: todos = [] } = useTodos();
  const treeRef = useRef<TreeApi<TreeItem> | null>(null);

  const counts = useMemo(() => {
    const b = bucketTodos(todos, todayStr(), settings.upcomingDays);
    return {
      inbox: todos.filter((t) => isOpen(t) && !t.folderId && !t.parentId).length,
      today: b.overdue.length + b.today.length,
      overdue: b.overdue.length,
    };
  }, [todos, settings.upcomingDays]);

  /** Folder that new notes/folders go into: the one currently open (or containing the open note). */
  const currentFolderPath = async () => {
    if (view.kind === "folder") return notes.folderPathForId(view.id);
    if (view.kind === "note") {
      const meta = await notes.getNoteMeta(view.id);
      return meta ? dirname(meta.path) : "";
    }
    return "";
  };

  const newNote = async () => {
    const meta = await notes.createNote(await currentFolderPath());
    setView({ kind: "note", id: meta.id });
  };
  const newFolder = async () => {
    const f = await notes.createFolder(await currentFolderPath());
    useUI.getState().requestRename(`f:${f.id}`);
  };

  const nextTheme = { system: "light", light: "dark", dark: "system" } as const;
  const ThemeIcon = { system: Monitor, light: Sun, dark: Moon }[settings.theme];

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-11 items-center justify-between px-3" data-tauri-drag-region>
        <span className="text-sm font-semibold tracking-tight">Forgor</span>
        <Tooltip content={`Add todo (${shortcutLabel("Mod+Shift+A")})`}>
          <Button size="icon" variant="ghost" onClick={() => openQuickAdd()} aria-label="Add todo">
            <Plus />
          </Button>
        </Tooltip>
      </div>

      <nav className="space-y-px px-2">
        <NavItem icon={Inbox} label="Inbox" count={counts.inbox} target={{ kind: "inbox" }} />
        <NavItem icon={Sun} label="Today" count={counts.today} alert={counts.overdue > 0} target={{ kind: "today" }} />
        <NavItem icon={CalendarClock} label="Upcoming" target={{ kind: "upcoming" }} />
        <NavItem icon={CalendarDays} label="Calendar" target={{ kind: "calendar" }} />
        <NavItem icon={Search} label="Search" hint={shortcutLabel("Mod+K")} target={{ kind: "search" }} />
        <NavItem icon={Archive} label="Archive" target={{ kind: "archive" }} />
      </nav>

      <div className="mt-4 flex items-center justify-between pl-4 pr-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</span>
        <div className="flex">
          <Tooltip content="New note">
            <Button size="icon-sm" variant="ghost" onClick={newNote} aria-label="New note">
              <FilePlus />
            </Button>
          </Tooltip>
          <Tooltip content="New folder">
            <Button size="icon-sm" variant="ghost" onClick={newFolder} aria-label="New folder">
              <FolderPlus />
            </Button>
          </Tooltip>
          <Tooltip content="Collapse all">
            <Button size="icon-sm" variant="ghost" onClick={() => treeRef.current?.closeAll()} aria-label="Collapse all">
              <ChevronsDownUp />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-1">
        <Explorer treeRef={treeRef} />
      </div>

      <div className="space-y-px border-t px-2 py-2">
        <UpdateNotice />
        <NavItem icon={Trash2} label="Trash" target={{ kind: "trash" }} />
        <div className="flex items-center">
          <div className="flex-1">
            <NavItem icon={Settings} label="Settings" target={{ kind: "settings" }} />
          </div>
          <Tooltip content={`Theme: ${settings.theme}`}>
            <Button size="icon" variant="ghost" onClick={() => updateSetting("theme", nextTheme[settings.theme])} aria-label="Toggle theme">
              <ThemeIcon />
            </Button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}

/** Shown only when a newer version exists; clicking opens Settings where you install it. */
function UpdateNotice() {
  const status = useUpdates((s) => s.status);
  const setView = useUI((s) => s.setView);
  if (status.kind !== "available" && status.kind !== "installing" && status.kind !== "ready") return null;
  const label = status.kind === "ready" ? "Restart to update" : status.kind === "installing" ? "Updating…" : `Update to ${status.update.version}`;
  return (
    <button
      onClick={() => setView({ kind: "settings" })}
      className="mb-1 flex h-7 w-full items-center gap-2 rounded bg-accent px-2 text-[13px] font-medium text-accent-foreground hover:bg-accent/80"
      data-testid="update-notice"
    >
      <Download className="size-4" />
      {label}
    </button>
  );
}

function NavItem({
  icon: Icon,
  label,
  count,
  alert,
  hint,
  target,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  alert?: boolean;
  hint?: string;
  target: View;
}) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const active = view.kind === target.kind;
  return (
    <button
      onClick={() => setView(target)}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded px-2 text-[13px]",
        active ? "bg-accent font-medium text-accent-foreground" : "text-foreground/85 hover:bg-muted",
      )}
      data-testid={`nav-${target.kind}`}
    >
      <Icon className={cn("size-4", active ? "text-accent-foreground" : "text-muted-foreground")} />
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      {!!count && <span className={cn("text-xs tabular-nums", alert ? "text-destructive" : "text-muted-foreground")}>{count}</span>}
    </button>
  );
}
