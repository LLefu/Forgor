import { FileText, Folder, ListTodo, Paperclip, RotateCcw, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTrash } from "@/app/queries";
import { emptyTrash, purgeTrashItem, restoreTrashItem } from "@/data/history";
import { PageHeader } from "@/features/todos/TodosPage";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { confirmDialog } from "@/components/ConfirmDialog";

const ICONS = { note: FileText, folder: Folder, todo: ListTodo, file: Paperclip };

export function TrashView() {
  const { data: items = [] } = useTrash();
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Trash" subtitle="Deleted notes, folders and todos, and completed todos after a while (Settings). Restore them or delete them for good.">
        {items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Empty trash?",
                message: `Permanently delete ${items.length} item${items.length === 1 ? "" : "s"}. This cannot be undone.`,
                confirmLabel: "Delete permanently",
                destructive: true,
              });
              if (ok) await emptyTrash();
            }}
          >
            <Trash2 /> Empty trash
          </Button>
        )}
      </PageHeader>
      <div className="px-6">
        {items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Trash is empty.</p>}
        {items.map((it) => {
          const Icon = ICONS[it.kind];
          return (
            <div key={it.id} className="group flex items-center gap-3 rounded px-2 py-2 hover:bg-muted/70" data-testid="trash-item">
              <Icon className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px]">{it.title}</div>
                <div className="text-xs text-muted-foreground">
                  {it.originalPath ? `${it.originalPath} · ` : ""}deleted {formatDistanceToNow(new Date(it.deletedAt), { addSuffix: true })}
                </div>
              </div>
              <Tooltip content="Restore">
                <Button size="icon" variant="ghost" onClick={() => restoreTrashItem(it.id)} aria-label="Restore">
                  <RotateCcw />
                </Button>
              </Tooltip>
              <Tooltip content="Delete permanently">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: "Delete permanently?",
                      message: `"${it.title}" will be deleted for good. This cannot be undone.`,
                      confirmLabel: "Delete permanently",
                      destructive: true,
                    });
                    if (ok) await purgeTrashItem(it.id);
                  }}
                  aria-label="Delete permanently"
                >
                  <Trash2 />
                </Button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}

