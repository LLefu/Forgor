import { useEffect, useRef, useState } from "react";
import { ChevronRight, History, MoreHorizontal, Trash2, ExternalLink, Link2, FileText, ListTodo } from "lucide-react";
import { useUI } from "@/app/store";
import { useBacklinks, useFolders, useNoteMeta, useNotes, useTodosForNote } from "@/app/queries";
import { onDataChange } from "@/data/context";
import * as notes from "@/data/notes";
import { saveNote } from "@/data/noteSave";
import { createTodo, linkNote } from "@/data/todos";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";
import { HistoryDialog } from "@/features/history/HistoryDialog";
import { TodoRow } from "@/features/todos/TodoRow";
import { TodoPicker } from "@/components/Pickers";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { resolveWikiTarget } from "@/lib/wikilinks";
import { dirname } from "@/lib/paths";
import { revealInOs } from "@/platform/os";
import { format } from "date-fns";

const SAVE_DELAY = 600;

export function NoteView({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<{ id: string; body: string } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setMissing(false);
    notes.readNote(id).then((n) => {
      if (cancelled) return;
      if (!n) setMissing(true);
      else setLoaded({ id, body: n.body });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (missing) return <p className="p-8 text-sm text-muted-foreground">This note no longer exists.</p>;
  if (!loaded || loaded.id !== id) return null;
  return <LoadedNote key={id} id={id} initialBody={loaded.body} />;
}

function LoadedNote({ id, initialBody }: { id: string; initialBody: string }) {
  const { data: meta } = useNoteMeta(id);
  const { data: allNotes = [] } = useNotes();
  const setView = useUI((s) => s.setView);
  const editor = useRef<NoteEditorHandle>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ---- saving: debounce edits, flush on unmount; reload on external changes when clean
  const lastSaved = useRef(initialBody);
  const pending = useRef<string | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = async () => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const md = pending.current;
    pending.current = null;
    if (md === null || md === lastSaved.current) return;
    saving.current = saveNote(id, md)
      .then((final) => {
        lastSaved.current = final;
      })
      .finally(() => {
        saving.current = null;
      });
    await saving.current;
  };

  const onChange = (md: string) => {
    pending.current = md;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  };

  useEffect(() => {
    const off = onDataChange(async (topics) => {
      if (!topics.includes("notes") || pending.current !== null || saving.current) return;
      const n = await notes.readNote(id);
      if (!n || pending.current !== null || saving.current) return;
      if (n.body !== lastSaved.current) {
        lastSaved.current = n.body;
        editor.current?.setMarkdown(n.body);
      }
    });
    return () => {
      off();
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openWikiLink = async (target: string) => {
    const hit = resolveWikiTarget(target, allNotes);
    if (hit) return setView({ kind: "note", id: hit });
    const created = await notes.createNote(meta ? dirname(meta.path) : "", target);
    setView({ kind: "note", id: created.id });
  };

  if (!meta) return null;
  return (
    <div className="flex h-full flex-col">
      <NoteToolbar meta={meta} onHistory={() => setHistoryOpen(true)} />
      <div className="min-h-0 flex-1 overflow-y-auto" id="note-scroll">
        <div className="mx-auto max-w-[760px] px-10 pb-24">
          <TitleInput id={id} title={meta.title} onEnter={() => editor.current?.focus()} />
          <p className="mb-2 text-[11px] text-muted-foreground">Edited {format(new Date(meta.updatedAt), "d MMM yyyy, HH:mm")}</p>
          <NoteEditor ref={editor} noteId={id} notePath={meta.path} initial={initialBody} onChange={onChange} onOpenWikiLink={openWikiLink} />
          <NoteFooter noteId={id} folderId={meta.folderId} />
        </div>
      </div>
      {historyOpen && (
        <HistoryDialog
          noteId={id}
          onClose={() => setHistoryOpen(false)}
          onRestored={(body) => {
            lastSaved.current = body;
            editor.current?.setMarkdown(body);
          }}
          beforeRestore={flush}
        />
      )}
    </div>
  );
}

function TitleInput({ id, title, onEnter }: { id: string; title: string; onEnter: () => void }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  const commit = async () => {
    if (value.trim() && value.trim() !== title) {
      const m = await notes.renameNote(id, value.trim());
      if (m) setValue(m.title);
    } else setValue(title);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
          onEnter();
        }
      }}
      className="mt-8 w-full bg-transparent text-[28px] font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
      placeholder="Untitled"
      aria-label="Note title"
      data-testid="note-title"
    />
  );
}

function NoteToolbar({ meta, onHistory }: { meta: { id: string; path: string; folderId: string | null }; onHistory: () => void }) {
  const setView = useUI((s) => s.setView);
  const { data: folders = [] } = useFolders();
  const { data: linked = [] } = useTodosForNote(meta.id);
  const segments = dirname(meta.path) ? dirname(meta.path).split("/") : [];
  const open = linked.filter((t) => t.status !== "done").length;

  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
      <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {segments.map((seg, i) => {
          const path = segments.slice(0, i + 1).join("/");
          const folder = folders.find((f) => f.path === path);
          return (
            <span key={path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              <button className="truncate hover:text-foreground" onClick={() => folder && setView({ kind: "folder", id: folder.id })}>
                {seg}
              </button>
            </span>
          );
        })}
      </nav>
      <div className="flex items-center gap-1">
        {linked.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => document.getElementById("note-todos")?.scrollIntoView({ behavior: "smooth" })}
            data-testid="note-todo-count"
          >
            <ListTodo /> {open} open {open === 1 ? "todo" : "todos"}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onHistory} aria-label="Version history" title="Version history">
          <History />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onHistory}>
              <History /> Version history
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => revealInOs(meta.path)}>
              <ExternalLink /> Show in file explorer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                if (!confirm("Move this note to the trash?")) return;
                await notes.trashNote(meta.id);
                setView({ kind: "today" });
              }}
            >
              <Trash2 /> Move to trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function NoteFooter({ noteId, folderId }: { noteId: string; folderId: string | null }) {
  const { data: linked = [] } = useTodosForNote(noteId);
  const { data: backlinks = [] } = useBacklinks(noteId);
  const setView = useUI((s) => s.setView);

  return (
    <div className="mt-6 space-y-6 border-t pt-5">
      <section id="note-todos" data-testid="note-linked-todos">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-foreground/80">Linked todos</h3>
          <TodoPicker
            exclude={linked.map((t) => t.id)}
            onPick={(todoId) => linkNote(todoId, noteId)}
            onCreate={async (title) => {
              const t = await createTodo({ title, folderId });
              await linkNote(t.id, noteId);
            }}
            trigger={
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" data-testid="link-todo">
                <Link2 className="size-3.5" /> Link or create todo
              </button>
            }
          />
        </div>
        {linked.length === 0 ? (
          <p className="text-xs text-muted-foreground">No linked todos. Type “- [ ] something” in the note to create one.</p>
        ) : (
          linked.map((t) => <TodoRow key={t.id} todo={t} />)
        )}
      </section>

      {backlinks.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-foreground/80">Linked from</h3>
          {backlinks.map((n) => (
            <button
              key={n.id}
              onClick={() => setView({ kind: "note", id: n.id })}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-muted"
            >
              <FileText className="size-3.5 text-muted-foreground" /> {n.title}
              <span className="ml-auto text-xs text-muted-foreground">{dirname(n.path)}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
