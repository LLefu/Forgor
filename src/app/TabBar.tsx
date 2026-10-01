import { useEffect, useRef, useState } from "react";
import { X, FileText, Inbox, Sun, ListTodo, CalendarDays, Search, Archive, Trash2, Settings, AudioLines } from "lucide-react";
import { useUI, type PageKind, type Tab } from "./store";
import { useNotes } from "./queries";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/menu";
import { ItemMenuItems, noteItem } from "@/features/explorer/ItemMenu";

const PAGES: Record<PageKind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  inbox: { label: "Inbox", icon: Inbox },
  today: { label: "Today", icon: Sun },
  all: { label: "All tasks", icon: ListTodo },
  calendar: { label: "Calendar", icon: CalendarDays },
  meetings: { label: "Meetings", icon: AudioLines },
  search: { label: "Search", icon: Search },
  archive: { label: "Archive", icon: Archive },
  trash: { label: "Trash", icon: Trash2 },
  settings: { label: "Settings", icon: Settings },
};

/**
 * Tabs across the top. Drag to reorder, middle-click or × to close,
 * right-click for the same menu as in the explorer.
 */
export function TabBar() {
  const tabs = useUI((s) => s.tabs);
  const moveTab = useUI((s) => s.moveTab);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // Tabs are restored from the last session; drop the ones whose note is gone (once, at startup).
  const { data: notes, isFetched } = useNotes();
  const pruned = useRef(false);
  useEffect(() => {
    if (!isFetched || !notes || pruned.current) return;
    pruned.current = true;
    const ids = new Set(notes.map((n) => n.id));
    const ui = useUI.getState();
    for (const t of ui.tabs) if (t.view.kind === "note" && !ids.has(t.view.id)) useUI.getState().closeTab(t.id);
  }, [isFetched, notes]);

  return (
    <div
      className="flex h-9 shrink-0 items-end overflow-x-auto border-b bg-sidebar [scrollbar-width:none]"
      role="tablist"
      data-testid="tabbar"
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        // Tabs handle their own dragover; anywhere else in the bar means "move to the end".
        setDropAt(tabs.length);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragging && dropAt !== null) {
          const from = tabs.findIndex((t) => t.id === dragging);
          moveTab(dragging, dropAt > from ? dropAt - 1 : dropAt);
        }
        setDragging(null);
        setDropAt(null);
      }}
    >
      {tabs.map((tab, i) => (
        <TabButton
          key={tab.id}
          tab={tab}
          index={i}
          dragging={dragging === tab.id}
          dropBefore={dropAt === i && !!dragging}
          dropAfter={dropAt === tabs.length && i === tabs.length - 1 && !!dragging}
          onDragStart={() => setDragging(tab.id)}
          onDragEnd={() => {
            setDragging(null);
            setDropAt(null);
          }}
          onDragOverTab={(before) => setDropAt(before ? i : i + 1)}
        />
      ))}
      <div className="h-full min-w-4 flex-1" />
    </div>
  );
}

function TabButton({
  tab,
  index,
  dragging,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragEnd,
  onDragOverTab,
}: {
  tab: Tab;
  index: number;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverTab: (before: boolean) => void;
}) {
  const active = useUI((s) => s.activeTab === tab.id);
  const activateTab = useUI((s) => s.activateTab);
  const closeTab = useUI((s) => s.closeTab);
  const closeOtherTabs = useUI((s) => s.closeOtherTabs);
  const closeAllTabs = useUI((s) => s.closeAllTabs);
  const count = useUI((s) => s.tabs.length);
  const { data: notes = [] } = useNotes();

  const note = tab.view.kind === "note" ? notes.find((n) => n.id === (tab.view as { id: string }).id) : null;
  const page = tab.view.kind !== "note" ? PAGES[tab.view.kind] : null;
  const title = page ? page.label : (note?.title ?? "Missing note");
  const Icon = page ? page.icon : FileText;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          draggable
          title={note ? note.path : title}
          onClick={() => activateTab(tab.id)}
          onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no autoscroll */}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(tab.id);
            }
          }}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", title);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onDragOverTab(e.clientX < r.left + r.width / 2);
          }}
          className={cn(
            "group relative flex h-full min-w-0 max-w-52 shrink-0 cursor-pointer select-none items-center gap-1.5 border-r pl-3 pr-1.5 text-[12.5px]",
            active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            dragging && "opacity-40",
          )}
          data-testid="tab"
          data-title={title}
          data-index={index}
        >
          {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
          {/* The active tab covers the bar's bottom border so it joins the page below. */}
          {active && <span className="absolute inset-x-0 -bottom-px h-px bg-background" />}
          {dropBefore && <span className="absolute inset-y-1 -left-px w-0.5 rounded bg-ring" />}
          {dropAfter && <span className="absolute inset-y-1 -right-px w-0.5 rounded bg-ring" />}
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{title}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            aria-label={`Close ${title}`}
            className={cn(
              "ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted-foreground/15",
              active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70",
            )}
            data-testid="tab-close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => closeTab(tab.id)}>Close</ContextMenuItem>
        <ContextMenuItem disabled={count < 2} onSelect={() => closeOtherTabs(tab.id)}>
          Close other tabs
        </ContextMenuItem>
        <ContextMenuItem onSelect={closeAllTabs}>Close all</ContextMenuItem>
        {note && (
          <>
            <ContextMenuSeparator />
            <ItemMenuItems item={noteItem(note)} showReveal />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
