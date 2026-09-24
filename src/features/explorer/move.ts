import { useState } from "react";
import type { TreeApi } from "react-arborist";
import * as notes from "@/data/notes";
import { joinPath } from "@/lib/paths";
import type { TreeItem } from "./Explorer";

/** Move explorer items (notes and folders) into `targetPath` ("" = top level). */
export async function moveTreeItems(items: TreeItem[], targetPath: string) {
  for (const item of items) {
    if (item.kind === "note") await notes.moveNote(item.refId, targetPath);
    else if (targetPath !== item.path && !targetPath.startsWith(item.path + "/")) {
      await notes.relocateFolder(item.refId, joinPath(targetPath, item.name));
    }
  }
}

/**
 * A plain (non-react-dnd) drop zone that moves whatever is being dragged in the
 * explorer tree to the top level. Used for the "Notes" header and the empty
 * space under the tree, which must live outside the tree's react-dnd root.
 */
export function useRootDropZone(getTree: () => TreeApi<TreeItem> | null) {
  const [over, setOver] = useState(false);
  const dragging = () => (getTree()?.dragNodes.length ?? 0) > 0;
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!dragging()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        const items = getTree()?.dragNodes.map((n) => n.data) ?? [];
        setOver(false);
        if (!items.length) return;
        e.preventDefault();
        void moveTreeItems(items, "");
      },
    },
  };
}
