import { useMemo } from "react";
import { FileText, Folder, FilePlus, ChevronRight } from "lucide-react";
import { useFolders, useNotes, useTodos } from "@/app/queries";
import { useUI } from "@/app/store";
import { PageHeader, Section } from "@/features/todos/TodosPage";
import { TodoRow } from "@/features/todos/TodoRow";
import { InlineAdd } from "@/features/todos/InlineAdd";
import { compareTodos, isOpen } from "@/lib/dates";
import { basename, dirname } from "@/lib/paths";
import * as notes from "@/data/notes";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

/** A folder is a project: its todos and notes on one page. */
export function FolderView({ id }: { id: string }) {
  const { data: folders = [] } = useFolders();
  const { data: allNotes = [] } = useNotes();
  const { data: todos = [] } = useTodos();
  const setView = useUI((s) => s.setView);
  const folder = folders.find((f) => f.id === id);

  const data = useMemo(() => {
    if (!folder) return null;
    const subfolders = folders.filter((f) => dirname(f.path) === folder.path);
    const inside = new Set(folders.filter((f) => f.path === folder.path || f.path.startsWith(folder.path + "/")).map((f) => f.id));
    const folderTodos = todos.filter((t) => t.folderId && inside.has(t.folderId) && !t.parentId);
    return {
      subfolders,
      notes: allNotes.filter((n) => dirname(n.path) === folder.path).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      open: folderTodos.filter(isOpen).sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || compareTodos(a, b)),
      done: folderTodos.filter((t) => t.status === "done"),
    };
  }, [folder, folders, allNotes, todos]);

  if (!folder || !data) return <p className="p-8 text-sm text-muted-foreground">Folder not found.</p>;
  const crumbs = dirname(folder.path) ? dirname(folder.path).split("/") : [];

  return (
    <div className="mx-auto max-w-3xl pb-16" data-testid="folder-view">
      {crumbs.length > 0 && (
        <div className="flex items-center gap-1 px-8 pt-5 text-xs text-muted-foreground">
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join("/");
            const f = folders.find((x) => x.path === p);
            return (
              <span key={p} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" />}
                <button className="hover:text-foreground" onClick={() => f && setView({ kind: "folder", id: f.id })}>
                  {c}
                </button>
              </span>
            );
          })}
        </div>
      )}
      <PageHeader title={basename(folder.path)} subtitle={`${data.open.length} open todos · ${data.notes.length} notes`}>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const n = await notes.createNote(folder.path);
            setView({ kind: "note", id: n.id });
          }}
        >
          <FilePlus /> New note
        </Button>
      </PageHeader>
      <div className="px-6">
        <Section title="Todos" count={data.open.length}>
          {data.open.map((t) => (
            <TodoRow key={t.id} todo={t} showFolder={t.folderId !== folder.id} />
          ))}
          <InlineAdd defaults={{ folderId: folder.id }} />
        </Section>

        {(data.subfolders.length > 0 || data.notes.length > 0) && (
          <Section title="Notes" count={data.notes.length}>
            {data.subfolders.map((f) => (
              <button key={f.id} onClick={() => setView({ kind: "folder", id: f.id })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13.5px] hover:bg-muted">
                <Folder className="size-4 text-muted-foreground" /> {basename(f.path)}
              </button>
            ))}
            {data.notes.map((n) => (
              <button key={n.id} onClick={() => setView({ kind: "note", id: n.id })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13.5px] hover:bg-muted">
                <FileText className="size-4 text-muted-foreground" />
                <span className="truncate">{n.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">{format(new Date(n.updatedAt), "d MMM")}</span>
              </button>
            ))}
          </Section>
        )}

        {data.done.length > 0 && (
          <Section title="Completed" count={data.done.length} collapsible>
            {data.done.map((t) => (
              <TodoRow key={t.id} todo={t} showFolder={false} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
