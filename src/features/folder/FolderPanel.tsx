import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Folder, FilePlus, ChevronRight, X, Trash2, ListTodo, LocateFixed, Paperclip, Image, Film, Music } from "lucide-react";
import { useAttachments, useFolders, useNotes, useTodos } from "@/app/queries";
import { openVaultFile } from "@/platform/os";
import { confirmDialog } from "@/components/ConfirmDialog";
import { fileKind } from "@/lib/files";
import { useUI } from "@/app/store";
import { Section } from "@/features/todos/TodosPage";
import { TodoRow } from "@/features/todos/TodoRow";
import { InlineAdd } from "@/features/todos/InlineAdd";
import { compareTodos, isOpen } from "@/lib/dates";
import { basename, dirname, joinPath } from "@/lib/paths";
import * as notes from "@/data/notes";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useResizableWidth } from "@/components/ResizeHandle";
import { trashItem } from "@/features/explorer/ItemMenu";
import { FolderColorButton, FolderLabel, useFolderColor } from "./folderColors";
import { format } from "date-fns";
import { noteLinkProps } from "@/app/noteLink";

/** A folder is a project: its todos, notes and subfolders in a panel on the right (like a todo's details). */
export function FolderPanel({ id }: { id: string }) {
  const { data: folders = [], isFetched } = useFolders();
  const openFolder = useUI((s) => s.openFolder);
  const folder = folders.find((f) => f.id === id);
  const { width, handle } = useResizableWidth("panelWidth", { min: 300, max: 720, edge: "left" });

  useEffect(() => {
    if (isFetched && !folder) openFolder(null); // deleted or trashed elsewhere
  }, [isFetched, folder, openFolder]);

  if (!folder) return null;
  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l bg-background" style={{ width }} data-testid="folder-panel">
      {handle}
      <FolderBody key={folder.id} folder={folder} />
    </aside>
  );
}

function FolderBody({ folder }: { folder: { id: string; path: string } }) {
  const { data: folders = [] } = useFolders();
  const { data: allNotes = [] } = useNotes();
  const { data: todos = [] } = useTodos();
  const setView = useUI((s) => s.setView);
  const openFolder = useUI((s) => s.openFolder);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const color = useFolderColor(folder.id);

  const data = useMemo(() => {
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

  const crumbs = dirname(folder.path) ? dirname(folder.path).split("/") : [];

  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-xs text-muted-foreground">Folder</span>
        <div className="flex shrink-0 items-center">
          <Tooltip content="Reveal in explorer">
            <Button size="icon" variant="ghost" onClick={() => useUI.getState().revealInExplorer(`f:${folder.id}`)} aria-label="Reveal in explorer">
              <LocateFixed />
            </Button>
          </Tooltip>
          <Tooltip content="Move to trash">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void trashItem({ kind: "folder", refId: folder.id, name: basename(folder.path) })}
              aria-label="Move folder to trash"
              data-testid="folder-trash"
            >
              <Trash2 />
            </Button>
          </Tooltip>
          <Button size="icon" variant="ghost" onClick={() => openFolder(null)} aria-label="Close">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {/* Parent folders; wraps onto more lines for deep paths. */}
        {crumbs.length > 0 && (
          <nav className="mb-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground" data-testid="folder-crumbs">
            {crumbs.map((c, i) => {
              const p = crumbs.slice(0, i + 1).join("/");
              const f = folders.find((x) => x.path === p);
              return (
                <span key={p} className="flex min-w-0 max-w-full items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3 shrink-0" />}
                  <button className="min-w-0 truncate hover:text-foreground" title={p} onClick={() => f && openFolder(f.id)}>
                    {c}
                  </button>
                </span>
              );
            })}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <Folder
            className="size-5 shrink-0"
            style={color ? { color, fill: `color-mix(in srgb, ${color} 25%, transparent)` } : { color: "var(--muted-foreground)" }}
          />
          <FolderName folder={folder} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.open.length} open {data.open.length === 1 ? "todo" : "todos"} · {data.notes.length} {data.notes.length === 1 ? "note" : "notes"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FolderColorButton folderId={folder.id} />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const n = await notes.createNote(folder.path);
              setView({ kind: "note", id: n.id });
              useUI.getState().requestRename(`n:${n.id}`);
            }}
          >
            <FilePlus /> New note
          </Button>
          <Button variant="outline" size="sm" onClick={() => openQuickAdd({ folderId: folder.id })}>
            <ListTodo /> New todo
          </Button>
        </div>

        <div className="mt-5">
          <Section title="Todos" count={data.open.length}>
            {data.open.map((t) => (
              <TodoRow key={t.id} todo={t} showFolder={t.folderId !== folder.id} />
            ))}
            <InlineAdd defaults={{ folderId: folder.id }} />
          </Section>

          {(data.subfolders.length > 0 || data.notes.length > 0) && (
            <Section title="Notes" count={data.notes.length}>
              {data.subfolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openFolder(f.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                >
                  <FolderLabel folderId={f.id} className="[&_svg]:size-4" />
                </button>
              ))}
              {data.notes.map((n) => (
                <button
                  key={n.id}
                  {...noteLinkProps(n.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                  data-testid="folder-note"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{n.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{format(new Date(n.updatedAt), "d MMM")}</span>
                </button>
              ))}
            </Section>
          )}

          <Attachments folderPath={folder.path} />

          {data.done.length > 0 && (
            <Section title="Completed" count={data.done.length} collapsible>
              {data.done.map((t) => (
                <TodoRow key={t.id} todo={t} showFolder={false} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

/** The folder name, editable in place (renames the folder on disk). */
function FolderName({ folder }: { folder: { id: string; path: string } }) {
  const name = basename(folder.path);
  const [value, setValue] = useState(name);
  const cancelled = useRef(false);
  useEffect(() => setValue(name), [name]);
  const commit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      setValue(name);
      return;
    }
    const next = value.trim();
    if (next && next !== name) await notes.relocateFolder(folder.id, joinPath(dirname(folder.path), next));
    else setValue(name);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
      aria-label="Folder name"
      data-testid="folder-name"
    />
  );
}

const FILE_ICONS = { image: Image, video: Film, audio: Music, other: Paperclip };

/** Files in the folder's _attachments folder: click to open, trash button to delete (restorable from Trash). */
function Attachments({ folderPath }: { folderPath: string }) {
  const { data: files = [] } = useAttachments(folderPath);
  if (!files.length) return null;
  const remove = async (path: string) => {
    const users = await notes.notesUsingFile(path);
    const ok = await confirmDialog({
      title: "Move attachment to trash?",
      message:
        `"${basename(path)}" will be moved to the trash. You can restore it from Trash.` +
        (users.length ? `

It is used in: ${users.map((n) => n.title).join(", ")}. The link there will stop working.` : ""),
      confirmLabel: "Move to trash",
      destructive: true,
    });
    if (ok) await notes.trashFile(path);
  };
  return (
    <Section title="Attachments" count={files.length}>
      {files.map((path) => {
        const Icon = FILE_ICONS[fileKind(path)];
        return (
          <div key={path} className="group flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-muted" data-testid="attachment">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <button className="min-w-0 flex-1 truncate text-left" title={`Open ${basename(path)}`} onClick={() => void openVaultFile(path)}>
              {basename(path)}
            </button>
            <Tooltip content="Move to trash">
              <button
                onClick={() => void remove(path)}
                className="rounded-sm p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Move ${basename(path)} to trash`}
                data-testid="attachment-trash"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        );
      })}
    </Section>
  );
}
