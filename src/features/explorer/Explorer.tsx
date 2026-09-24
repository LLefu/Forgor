import { useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist";
import { ChevronRight, FileText, Folder, FolderOpen, FilePlus, FolderPlus, Pencil, Trash2, ExternalLink, ListTodo } from "lucide-react";
import { useFolders, useNotes } from "@/app/queries";
import { useUI } from "@/app/store";
import * as notes from "@/data/notes";
import { basename, dirname, joinPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/menu";
import { revealInOs } from "@/platform/os";

export interface TreeItem {
  id: string; // "f:<folderId>" | "n:<noteId>"
  kind: "folder" | "note";
  refId: string;
  name: string;
  path: string;
  children?: TreeItem[];
}

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

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const activeId = view.kind === "note" ? `n:${view.id}` : view.kind === "folder" ? `f:${view.id}` : undefined;

  // Reveal the active item (expand its parents) when it changes.
  useEffect(() => {
    if (activeId) localTree.current?.openParents(activeId);
  }, [activeId]);

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
    <div
      ref={(el) => {
        box.current = el;
        setDndRoot(el);
      }}
      className="min-h-0 flex-1"
      data-testid="explorer"
    >
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
          height={size.h}
          rowHeight={26}
          indent={12}
          openByDefault={false}
          selection={activeId}
          disableMultiSelection
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
            for (const id of dragIds) {
              const item = findItem(data, id);
              if (!item) continue;
              if (item.kind === "note") await notes.moveNote(item.refId, targetPath);
              else if (targetPath !== item.path && !targetPath.startsWith(item.path + "/")) {
                await notes.relocateFolder(item.refId, joinPath(targetPath, item.name));
              }
            }
          }}
        >
          {Row}
        </Tree>
      )}
    </div>
  );
}

function findItem(items: TreeItem[], id: string): TreeItem | null {
  for (const i of items) {
    if (i.id === id) return i;
    const c = i.children && findItem(i.children, id);
    if (c) return c;
  }
  return null;
}

function Row({ node, style, dragHandle }: NodeRendererProps<TreeItem>) {
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const item = node.data;
  const isFolder = item.kind === "folder";

  const newNoteHere = async () => {
    const folderPath = isFolder ? item.path : dirname(item.path);
    const meta = await notes.createNote(folderPath);
    if (isFolder) node.open();
    setView({ kind: "note", id: meta.id });
    useUI.getState().requestRename(`n:${meta.id}`);
  };
  const newFolderHere = async () => {
    const parent = isFolder ? item.path : dirname(item.path);
    const f = await notes.createFolder(parent);
    if (isFolder) node.open();
    useUI.getState().requestRename(`f:${f.id}`);
  };
  const remove = async () => {
    const what = isFolder ? `the folder "${item.name}" and everything in it` : `"${item.name}"`;
    if (!confirm(`Move ${what} to the trash?`)) return;
    if (isFolder) await notes.trashFolder(item.refId);
    else await notes.trashNote(item.refId);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={dragHandle}
          style={style}
          className={cn(
            "group flex h-full cursor-pointer items-center gap-1 rounded-sm pr-2 text-[13px]",
            node.isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            node.willReceiveDrop && "ring-1 ring-inset ring-ring",
          )}
          onClick={(e) => {
            // Clicking a folder name opens its overview; only the arrow/icon expands or collapses it.
            if (isFolder && !node.isEditing) {
              e.stopPropagation();
              setView({ kind: "folder", id: item.refId });
            }
          }}
          data-testid={`tree-${item.kind}-${item.name}`}
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
              {node.isOpen ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
            </button>
          ) : (
            <>
              <span className="w-4 shrink-0" />
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
          {node.isEditing ? <RenameInput node={node} /> : <span className="truncate">{item.name}</span>}
        </div>
      </ContextMenuTrigger>
      {/* Don't hand focus back to the row on close: that would blur (and submit) the rename box. */}
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={newNoteHere}>
          <FilePlus /> New note
        </ContextMenuItem>
        <ContextMenuItem onSelect={newFolderHere}>
          <FolderPlus /> New folder
        </ContextMenuItem>
        {isFolder && (
          <ContextMenuItem onSelect={() => openQuickAdd({ folderId: item.refId })}>
            <ListTodo /> New todo in folder
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => useUI.getState().requestRename(node.id)}>
          <Pencil /> Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => revealInOs(item.path)}>
          <ExternalLink /> Show in file explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={remove}>
          <Trash2 /> Move to trash
        </ContextMenuItem>
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
