import { useMemo, useRef } from "react";
import type { TreeApi } from "react-arborist";
import {
  ListTodo,
  Sun,
  Search,
  Settings,
  FilePlus,
  FolderPlus,
  ChevronsDownUp,
  Plus,
  LocateFixed,
  Puzzle,
} from "lucide-react";
import { useResizableWidth } from "@/components/ResizeHandle";
import { useUI } from "./store";
import { useUpdates } from "./updates";
import { Download, ArrowLeft, ArrowRight, PanelLeftClose } from "lucide-react";
import { useTodos } from "./queries";
import { Explorer, type TreeItem } from "@/features/explorer/Explorer";
import { useRootDropZone } from "@/features/explorer/move";
import { isOpen } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import * as notes from "@/data/notes";
import { useShortcutLabel } from "./shortcuts";
import { NavItem } from "@/components/NavItem";
import { NotificationsMenu } from "@/features/notifications/NotificationsMenu";
import { PluginSidebarItems } from "@/plugins/views";

export function Sidebar() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const goBack = useUI((s) => s.goBack);
  const todoKeys = useShortcutLabel("new-todo");
  const sidebarKeys = useShortcutLabel("toggle-sidebar");
  const searchKeys = useShortcutLabel("search-page");
  const backKeys = useShortcutLabel("back");
  const forwardKeys = useShortcutLabel("forward");
  const goForward = useUI((s) => s.goForward);
  const canBack = useUI((s) => s.back.length > 0);
  const canForward = useUI((s) => s.forward.length > 0);
  const { data: todos = [] } = useTodos();
  const treeRef = useRef<TreeApi<TreeItem> | null>(null);
  const rootDrop = useRootDropZone(() => treeRef.current);

  const openCount = useMemo(() => todos.filter((t) => isOpen(t) && !t.parentId).length, [todos]);

  const { width, handle } = useResizableWidth("sidebarWidth", { min: 200, max: 520, edge: "right" });

  /** New notes/folders/todos go into the folder whose panel is open, else the top level. */
  const currentFolderPath = async () => notes.folderPathForId(useUI.getState().selectedFolderId);
  const newTodo = () => {
    const folderId = useUI.getState().selectedFolderId;
    openQuickAdd(folderId ? { folderId } : {});
  };

  const newNote = async () => {
    const meta = await notes.createNote(await currentFolderPath());
    setView({ kind: "note", id: meta.id });
    useUI.getState().requestRename(`n:${meta.id}`);
  };
  const newFolder = async () => {
    const f = await notes.createFolder(await currentFolderPath());
    useUI.getState().requestRename(`f:${f.id}`);
  };

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-r bg-sidebar" style={{ width }}>
      {handle}
      <div className="flex h-11 items-center justify-between px-2">
        <div className="flex items-center gap-1">
          <Tooltip content={`Back${backKeys ? ` (${backKeys})` : ""}`}>
            <Button size="icon" variant="ghost" onClick={goBack} disabled={!canBack} aria-label="Back" data-testid="nav-back">
              <ArrowLeft />
            </Button>
          </Tooltip>
          <Tooltip content={`Forward${forwardKeys ? ` (${forwardKeys})` : ""}`}>
            <Button size="icon" variant="ghost" onClick={goForward} disabled={!canForward} aria-label="Forward" data-testid="nav-forward">
              <ArrowRight />
            </Button>
          </Tooltip>
          <span className="ml-1 text-sm font-semibold tracking-tight">Forgor</span>
        </div>
        <div className="flex items-center">
          <Tooltip content={`Add todo${todoKeys ? ` (${todoKeys})` : ""}`}>
            <Button size="icon" variant="ghost" onClick={newTodo} aria-label="Add todo">
              <Plus />
            </Button>
          </Tooltip>
          <Tooltip content={`Hide sidebar${sidebarKeys ? ` (${sidebarKeys})` : ""}`}>
            <Button size="icon" variant="ghost" onClick={() => void useUI.getState().updateSetting("sidebarHidden", true)} aria-label="Hide sidebar" data-testid="hide-sidebar">
              <PanelLeftClose />
            </Button>
          </Tooltip>
        </div>
      </div>

      <nav className="space-y-px px-2">
        <NavItem icon={Sun} label="Today" target={{ kind: "today" }} />
        <NavItem icon={ListTodo} label="Todos" count={openCount} target={{ kind: "all" }} />
        <PluginSidebarItems />
        <NavItem icon={Search} label="Search" hint={searchKeys} target={{ kind: "search" }} />
      </nav>

      <div
        {...rootDrop.props}
        className={cn(
          "mx-2 mt-4 flex items-center justify-between rounded-sm pl-2 pr-0",
          rootDrop.over && "bg-accent ring-1 ring-inset ring-ring",
        )}
        data-testid="notes-header"
      >
        <span className={cn("text-[11px] font-semibold uppercase tracking-wider", rootDrop.over ? "text-accent-foreground" : "text-muted-foreground")}>
          {rootDrop.over ? "Move to top level" : "Notes"}
        </span>
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
          <Tooltip content="New todo">
            <Button size="icon-sm" variant="ghost" onClick={newTodo} aria-label="New todo">
              <ListTodo />
            </Button>
          </Tooltip>
          <Tooltip content="Reveal the open note in the explorer">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={view?.kind !== "note"}
              onClick={() => view?.kind === "note" && useUI.getState().revealInExplorer(`n:${view.id}`)}
              aria-label="Reveal open note"
              data-testid="reveal-note"
            >
              <LocateFixed />
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
        <NavItem icon={Puzzle} label="Plugins" target={{ kind: "plugins" }} />
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <NavItem icon={Settings} label="Settings" target={{ kind: "settings" }} />
          </div>
          <NotificationsMenu />
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
