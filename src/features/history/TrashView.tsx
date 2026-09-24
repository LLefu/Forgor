import { FileText, Folder, ListTodo, RotateCcw, Trash2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useArchived, useTrash } from "@/app/queries";
import { emptyTrash, purgeTrashItem, restoreTrashItem } from "@/data/history";
import { PageHeader } from "@/features/todos/TodosPage";
import { TodoRow } from "@/features/todos/TodoRow";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useUI } from "@/app/store";

const ICONS = { note: FileText, folder: Folder, todo: ListTodo };

export function TrashView() {
  const { data: items = [] } = useTrash();
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Trash" subtitle="Deleted notes, folders and todos. Restore them or delete them for good.">
        {items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (confirm(`Permanently delete ${items.length} item(s)? This cannot be undone.`)) await emptyTrash();
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
                    if (confirm(`Permanently delete "${it.title}"?`)) await purgeTrashItem(it.id);
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

export function ArchiveView() {
  const { data: todos = [] } = useArchived();
  const days = useUI((s) => s.settings.archiveAfterDays);
  const groups = new Map<string, typeof todos>();
  for (const t of todos) {
    const key = t.completedAt ? format(new Date(t.completedAt), "MMMM yyyy") : "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Archive" subtitle={`Completed todos are moved here ${days} day${days === 1 ? "" : "s"} after completion. Change this in Settings.`} />
      <div className="px-6">
        {todos.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing archived yet.</p>}
        {[...groups.entries()].map(([month, list]) => (
          <section key={month} className="mb-5">
            <h3 className="mb-1 border-b pb-1 text-xs font-semibold text-foreground/80">{month}</h3>
            {list.map((t) => (
              <TodoRow key={t.id} todo={t} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
