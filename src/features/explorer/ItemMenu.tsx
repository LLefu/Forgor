import { FilePlus, FolderPlus, Pencil, Trash2, ExternalLink, ListTodo, Palette, LocateFixed } from "lucide-react";
import { useFolders } from "@/app/queries";
import { useUI } from "@/app/store";
import * as notes from "@/data/notes";
import { dirname } from "@/lib/paths";
import {
  ContextMenuItem,
  ContextMenuItemRaw,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/menu";
import { ColorSwatches } from "@/features/folder/folderColors";
import { revealInOs } from "@/platform/os";
import { confirmDialog } from "@/components/ConfirmDialog";

/** A note or folder as shown in the explorer (also used by tabs). */
export interface TreeItem {
  id: string; // "f:<folderId>" | "n:<noteId>"
  kind: "folder" | "note";
  refId: string;
  name: string;
  path: string;
  children?: TreeItem[];
}

export function noteItem(n: { id: string; title: string; path: string }): TreeItem {
  return { id: `n:${n.id}`, kind: "note", refId: n.id, name: n.title, path: n.path };
}

/** Ask, then move a note or folder to the trash. */
export function trashItem(item: Pick<TreeItem, "kind" | "refId" | "name">): Promise<boolean> {
  return trashItems([item]);
}

/** Ask once, then move several notes/folders to the trash (items inside a selected folder go with it). */
export async function trashItems(items: Pick<TreeItem, "kind" | "refId" | "name">[]): Promise<boolean> {
  if (!items.length) return false;
  const folderPaths = new Map<string, string>();
  for (const i of items) if (i.kind === "folder") folderPaths.set(i.refId, await notes.folderPathForId(i.refId));
  const allNotes = await notes.listNotes();
  const insideSelected = (path: string, selfId?: string) =>
    [...folderPaths].some(([id, fp]) => id !== selfId && fp && path.startsWith(fp + "/"));
  const top = items.filter((i) =>
    i.kind === "folder" ? !insideSelected(folderPaths.get(i.refId) ?? "", i.refId) : !insideSelected(allNotes.find((n) => n.id === i.refId)?.path ?? ""),
  );

  const single = top.length === 1 ? top[0] : null;
  const ok = await confirmDialog({
    title: single ? (single.kind === "folder" ? "Move folder to trash?" : "Move note to trash?") : `Move ${top.length} items to trash?`,
    message: single
      ? `This moves ${single.kind === "folder" ? `the folder "${single.name}" and everything in it` : `"${single.name}"`} to the trash. You can restore it from Trash.`
      : `${top.map((i) => (i.kind === "folder" ? `• ${i.name} (folder, with everything in it)` : `• ${i.name}`)).join("\n")}\n\nYou can restore them from Trash.`,
    confirmLabel: "Move to trash",
    destructive: true,
  });
  if (!ok) return false;

  // Tabs of trashed notes close.
  const gone = new Set<string>();
  for (const item of top) {
    if (item.kind === "folder") {
      const path = folderPaths.get(item.refId) ?? "";
      allNotes.filter((n) => n.path.startsWith(path + "/")).forEach((n) => gone.add(n.id));
      await notes.trashFolder(item.refId);
      if (useUI.getState().selectedFolderId === item.refId) useUI.getState().openFolder(null);
    } else {
      gone.add(item.refId);
      await notes.trashNote(item.refId);
    }
  }
  for (const tab of useUI.getState().tabs) if (tab.view.kind === "note" && gone.has(tab.view.id)) useUI.getState().closeTab(tab.id);
  return true;
}

/**
 * Right-click menu entries for a note or folder: the explorer and the tab bar
 * show the same menu. `onOpenFolder` lets the tree expand a folder after
 * something was created inside it.
 */
export function ItemMenuItems({ item, onOpenFolder, showReveal }: { item: TreeItem; onOpenFolder?: () => void; showReveal?: boolean }) {
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const { data: folders = [] } = useFolders();
  const isFolder = item.kind === "folder";
  const ownColor = isFolder ? (folders.find((f) => f.id === item.refId)?.color ?? null) : null;
  const here = isFolder ? item.path : dirname(item.path);

  const newNoteHere = async () => {
    const meta = await notes.createNote(here);
    onOpenFolder?.();
    setView({ kind: "note", id: meta.id });
    useUI.getState().requestRename(`n:${meta.id}`);
  };
  const newFolderHere = async () => {
    const f = await notes.createFolder(here);
    onOpenFolder?.();
    useUI.getState().requestRename(`f:${f.id}`);
  };

  return (
    <>
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
      {isFolder && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Palette /> Color
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="p-1.5">
            <ColorSwatches
              value={ownColor}
              onPick={(c) => void notes.setFolderColor(item.refId, c)}
              wrap={(el, key) => (
                <ContextMenuItemRaw key={key} asChild className="outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-ring">
                  {el}
                </ContextMenuItemRaw>
              )}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuItem onSelect={() => useUI.getState().requestRename(item.id)}>
        <Pencil /> Rename
      </ContextMenuItem>
      {showReveal && (
        <ContextMenuItem onSelect={() => useUI.getState().revealInExplorer(item.id)}>
          <LocateFixed /> Reveal in explorer
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => revealInOs(item.path)}>
        <ExternalLink /> Show in file explorer
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem destructive onSelect={() => void trashItem(item)}>
        <Trash2 /> Move to trash
      </ContextMenuItem>
    </>
  );
}
