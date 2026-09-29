import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";
import { ChevronRight, FileText, Folder, FolderOpen, PanelRight, FilePlus, FolderPlus, ListTodo } from "lucide-react";
import { useFolders, useNotes } from "@/app/queries";
import { useUI } from "@/app/store";
import * as notes from "@/data/notes";
import { basename, dirname, joinPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/menu";
import { effectiveFolderColor } from "@/lib/folderColors";
import { moveTreeItems, useRootDropZone } from "./move";
import { ItemMenuItems, trashItems, type TreeItem } from "./ItemMenu";

export type { TreeItem };

function buildTree(folders: { id: string; path: string }[], noteList: { id: string; path: string; title: string }[]): TreeItem[] {
  const root: TreeItem[] = [];
  const byPath = new Map<string, TreeItem>();
  for (const f of [...folders].sort((a, b) => a.path.localeCompare(b.path))) {
    const item: TreeItem = { id: `f:${f.id}`, kind: "folder", refId: f.id, name: basename(f.path), path: f.path, children: [] };
    byPath.set(f.path, item);
    (byPath.get(dirname(f.path))?.children ?? root).push(item);
  }
  for (const n of noteList) {
    const item: TreeItem = { id: `n:${n.id}`, kind: "note", refId: n.id, name: n.title, path: n.path };
    (byPath.get(dirname(n.path))?.children ?? root).push(item);
  }
  const sort = (items: TreeItem[]) => {
    items.sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
    items.forEach((i) => i.children && sort(i.children));
  };
  sort(root);
  return root;
}

export function Explorer({ treeRef }: { treeRef?: React.MutableRefObject<TreeApi<TreeItem> | null> }) {
  const { data: folders = [] } = useFolders();
  const { data: noteList = [] } = useNotes();
  const data = useMemo(() => buildTree(folders, noteList), [folders, noteList]);
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const box = useRef<HTMLDivElement>(null);
  const localTree = useRef<TreeApi<TreeItem> | null>(null);
  const [size, setSize] = useState({ w: 240, h: 300 });
  // react-dnd (used by the tree) listens for drops on its root. The default root is the
  // whole window, where it swallowed the editor's block drags; scope it to the explorer.
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);
  // The tree is only as tall as its rows; the space below is a "move to top level" drop zone.
  const [visibleRows, setVisibleRows] = useState(0);
  const recount = () => setTimeout(() => setVisibleRows(localTree.current?.visibleNodes.length ?? 0), 0);
  useEffect(() => {
    recount();
  }, [data]);
  const rootDrop = useRootDropZone(() => localTree.current);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // Selected row: the open note, else the folder shown in the side panel.
  // A folder whose panel is open is also marked separately (PanelContext).
  const selectedFolderId = useUI((s) => s.selectedFolderId);
  const noteId = view?.kind === "note" ? view.id : null;
  const activeId = noteId ? `n:${noteId}` : selectedFolderId ? `f:${selectedFolderId}` : undefined;

  /** Selected rows (Ctrl/⌘+click and Shift+click select several), top to bottom; else the active row. */
  const selectedItems = (): TreeItem[] => {
    const nodes = [...(localTree.current?.selectedNodes ?? [])].sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
    if (nodes.length) return nodes.map((n) => n.data);
    const item = activeId ? findItem(data, activeId) : null;
    return item ? [item] : [];
  };

  // Delete / Backspace: trash the selection (after confirming). Enter: open it
  // (every selected note in a tab, and the topmost selected folder in the panel). F2: rename.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      const items = selectedItems();
      if (!items.length) return;
      e.preventDefault();
      e.stopPropagation();
      void trashItems(items);
    } else if (e.key === "Enter") {
      const items = selectedItems();
      if (!items.length) return;
      e.preventDefault();
      e.stopPropagation();
      const folder = items.find((i) => i.kind === "folder");
      for (const n of items.filter((i) => i.kind === "note")) setView({ kind: "note", id: n.refId });
      if (folder) useUI.getState().openFolder(folder.refId);
    } else if (e.key === "F2") {
      const [item] = selectedItems();
      if (!item) return;
      e.preventDefault();
      useUI.getState().requestRename(item.id);
    }
  };
  const closePanel = useUI((s) => s.closePanel);
  const openQuickAdd = useUI((s) => s.openQuickAdd);

  // Reveal the active item (expand its parents) when it changes.
  useEffect(() => {
    if (activeId) localTree.current?.openParents(activeId);
  }, [activeId]);

  // "Reveal in explorer": expand the parents, scroll the row into view and flash it.
  const reveal = useUI((s) => s.reveal);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!reveal) return;
    const tree = localTree.current;
    if (!tree) return;
    // openParents searches the whole tree; get()/scrollTo only see rows that are visible.
    tree.openParents(reveal.treeId);
    recount();
    setTimeout(() => tree.scrollTo(reveal.treeId, "center"), 30);
    setFlash(reveal.treeId);
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [reveal]);

  // Put a freshly created item into rename mode as soon as the tree has it.
  const pendingRename = useUI((s) => s.pendingRename);
  const requestRename = useUI((s) => s.requestRename);
  useEffect(() => {
    if (!pendingRename) return;
    // The tree builds its nodes a moment after new data arrives, so retry briefly.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const tree = localTree.current;
      tree?.openParents(pendingRename); // collapsed rows aren't found by get()
      if (tree?.get(pendingRename)) {
        tree.openParents(pendingRename);
        requestRename(null);
        setTimeout(() => tree.get(pendingRename)?.edit(), 0);
      } else if (++tries < 40) {
        timer = setTimeout(attempt, 25);
      }
    };
    attempt();
    return () => clearTimeout(timer);
  }, [pendingRename, data, requestRename]);

  return (
    <FlashContext.Provider value={flash}>
    <PanelContext.Provider value={selectedFolderId}>
    <div ref={box} className="flex min-h-0 flex-1 flex-col" data-testid="explorer" onKeyDownCapture={onKeyDown}>
      <div ref={setDndRoot} className="shrink-0">
      {data.length === 0 || !dndRoot ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">No notes yet. Use the + buttons above.</p>
      ) : (
        <Tree<TreeItem>
          ref={(t) => {
            localTree.current = t ?? null;
            if (treeRef) treeRef.current = t ?? null;
          }}
          data={data}
          dndRootElement={dndRoot}
          width={size.w}
          height={Math.min(size.h, Math.max(1, visibleRows) * 26 + 2)}
          onToggle={recount}
          rowHeight={26}
          indent={12}
          openByDefault={false}
          selection={activeId}
          disableDrop={({ parentNode }) => !!parentNode && !parentNode.isRoot && parentNode.data.kind !== "folder"}
          onActivate={(node) => {
            if (node.data.kind === "note") setView({ kind: "note", id: node.data.refId });
          }}
          onRename={async ({ id, name }) => {
            const item = findItem(data, id);
            if (!item || !name.trim()) return;
            if (item.kind === "note") await notes.renameNote(item.refId, name);
            else await notes.relocateFolder(item.refId, joinPath(dirname(item.path), name.trim()));
          }}
          onMove={async ({ dragIds, parentNode }) => {
            const targetPath = parentNode && !parentNode.isRoot ? parentNode.data.path : "";
            const items = dragIds.map((id) => findItem(data, id)).filter((i): i is TreeItem => !!i);
            await moveTreeItems(items, targetPath);
          }}
        >
          {Row}
        </Tree>
      )}
      </div>
      {/* Empty space: click closes the detail panel, right-click creates at the top level, drop moves to the top level. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            {...rootDrop.props}
            onClick={closePanel}
            className={cn(
              "min-h-8 flex-1 rounded-sm text-center text-[11px] text-transparent",
              rootDrop.over && "bg-accent/60 pt-2 text-accent-foreground ring-1 ring-inset ring-ring",
            )}
            data-testid="explorer-root-drop"
          >
            Move to top level
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem
            onSelect={async () => {
              const n = await notes.createNote("");
              setView({ kind: "note", id: n.id });
              useUI.getState().requestRename(`n:${n.id}`);
            }}
          >
            <FilePlus /> New note
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={async () => {
              const f = await notes.createFolder("");
              useUI.getState().requestRename(`f:${f.id}`);
            }}
          >
            <FolderPlus /> New folder
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openQuickAdd()}>
            <ListTodo /> New todo
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
    </PanelContext.Provider>
    </FlashContext.Provider>
  );
}

const FlashContext = createContext<string | null>(null);
/** Folder whose detail panel is open. */
const PanelContext = createContext<string | null>(null);

function findItem(items: TreeItem[], id: string): TreeItem | null {
  for (const i of items) {
    if (i.id === id) return i;
    const c = i.children && findItem(i.children, id);
    if (c) return c;
  }
  return null;
}

function Row({ node, style, dragHandle }: NodeRendererProps<TreeItem>) {
  const openFolder = useUI((s) => s.openFolder);
  const item = node.data;
  const isFolder = item.kind === "folder";
  const { data: folders = [] } = useFolders();
  const folderColor = isFolder ? effectiveFolderColor(item.refId, folders) : null;
  const flashing = useContext(FlashContext) === item.id;
  const panelFolderId = useContext(PanelContext);
  const inPanel = isFolder && panelFolderId === item.refId;
  const setView = useUI((s) => s.setView);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragHandle}
          style={style}
          className={cn(
            "group flex h-full cursor-pointer items-center gap-1 rounded-sm pr-2 text-[13px]",
            node.isSelected ? "bg-accent text-accent-foreground" : inPanel ? "bg-muted/70 hover:bg-muted" : "hover:bg-muted",
            node.willReceiveDrop && "ring-1 ring-inset ring-ring",
            flashing && "animate-[reveal-flash_1.2s_ease-out]",
          )}
          onClick={(e) => {
            // Ctrl/⌘/Shift+click: let the tree extend the selection (it doesn't open anything).
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;
            // Clicking a folder name shows it in the side panel; only the arrow/icon expands or collapses it.
            if (isFolder && !node.isEditing) {
              e.stopPropagation();
              node.select();
              openFolder(item.refId);
            }
          }}
          // Middle click: open the note in a tab (browsers would start auto-scrolling on mousedown).
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            if (isFolder) openFolder(item.refId);
            else setView({ kind: "note", id: item.refId });
          }}
          data-testid={`tree-${item.kind}-${item.name}`}
          data-panel-open={inPanel || undefined}
        >
          {isFolder ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={node.isOpen ? "Collapse folder" : "Expand folder"}
              className="flex shrink-0 items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                node.toggle();
              }}
              data-testid="tree-toggle"
            >
              <ChevronRight className={cn("size-3.5 w-4 transition-transform", node.isOpen && "rotate-90")} />
              {node.isOpen ? (
                <FolderOpen className="size-4" style={folderColor ? { color: folderColor } : undefined} />
              ) : (
                <Folder className="size-4" style={folderColor ? { color: folderColor, fill: `color-mix(in srgb, ${folderColor} 25%, transparent)` } : undefined} />
              )}
            </button>
          ) : (
            <>
              <span className="w-4 shrink-0" />
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
          {node.isEditing ? <RenameInput node={node} /> : <span className="truncate">{item.name}</span>}
          {inPanel && !node.isEditing && (
            <PanelRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-label="Shown in the side panel" data-testid="panel-marker" />
          )}
        </div>
      </ContextMenuTrigger>
      {/* Don't hand focus back to the row on close: that would blur (and submit) the rename box. */}
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ItemMenuItems item={item} onOpenFolder={() => isFolder && node.open()} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RenameInput({ node }: { node: NodeApi<TreeItem> }) {
  return (
    <input
      autoFocus
      defaultValue={node.data.name}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => node.submit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") node.reset();
        if (e.key === "Enter") node.submit(e.currentTarget.value);
      }}
      className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-[13px] outline-none"
    />
  );
}
