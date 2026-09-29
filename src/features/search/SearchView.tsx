import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, FileText, X } from "lucide-react";
import { search, EMPTY_FILTERS, HL_END, HL_START, type SearchFilters } from "@/data/search";
import { useFolders } from "@/app/queries";
import { useUI } from "@/app/store";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/DateTimePickers";
import { Button } from "@/components/ui/button";
import { TodoRow } from "@/features/todos/TodoRow";
import { Section } from "@/features/todos/TodosPage";
import { STATUS_LABELS, type TodoStatus } from "@/data/types";
import { basename, dirname } from "@/lib/paths";
import { FolderLabel } from "@/features/folder/folderColors";
import { noteLinkProps } from "@/app/noteLink";

/** Renders a snippet with \u0001…\u0002 highlight markers as <mark>, without HTML injection. */
export function Snippet({ text: raw }: { text: string }) {
  // Strip markdown syntax (keeps highlight markers intact) so snippets read as plain text.
  const text = raw
    .replace(/\s?\^t-[a-z0-9]+/g, "")
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // A snippet can start or end inside a link: drop the leftover "](url)" / "[".
    .replace(/\]\([^)\s]*\)?/g, "")
    .replace(/!?\[(?=[^\]]*$)/g, "")
    .replace(/(^|\s)#{1,6}\s/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[-*+] \[[ xX]\] /g, "$1")
    .replace(/\s+/g, " ");
  const parts = text.split(new RegExp(`(${HL_START}[^${HL_END}]*${HL_END})`));
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith(HL_START) ? (
          <mark key={i} className="rounded-sm bg-warning/30 px-0.5 text-foreground">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function SearchView() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-16 pt-7">
      <SearchPanel />
    </div>
  );
}

/**
 * Search box, filters and results (notes, folders, todos). Used by the Search
 * page and the floating search (Ctrl/⌘+Shift+F); `onDone` is called after a
 * result was opened.
 */
export function SearchPanel({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const { data: folders = [] } = useFolders();
  const setView = useUI((s) => s.setView);
  const openFolder = useUI((s) => s.openFolder);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 150);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener("focus-search", focus);
    focus();
    return () => window.removeEventListener("focus-search", focus);
  }, []);

  const { data } = useQuery({
    queryKey: ["search", debounced, filters],
    queryFn: () => search(debounced, filters),
    placeholderData: (prev) => prev,
  });
  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const hasQuery = debounced.trim() || filtered;
  const todoOnlyFilter = filters.priority !== null || filters.status !== null || !!filters.dueFrom || !!filters.dueTo;
  const q = debounced.trim().toLowerCase();
  const folderHits =
    q && filters.kind !== "todos" && !todoOnlyFilter
      ? folders
          .filter((f) => f.path.toLowerCase().includes(q) && (!filters.folderPath || f.path.startsWith(filters.folderPath + "/")))
          .sort((a, b) => Number(!basename(a.path).toLowerCase().startsWith(q)) - Number(!basename(b.path).toLowerCase().startsWith(q)))
          .slice(0, 8)
      : [];
  const openNote = (id: string) => {
    setView({ kind: "note", id });
    onDone?.();
  };
  const showFolder = (id: string) => {
    openFolder(id);
    onDone?.();
  };
  const openFirst = () => {
    if (data?.notes[0]) openNote(data.notes[0].note.id);
    else if (folderHits[0]) showFolder(folderHits[0].id);
    else if (data?.todos[0]) {
      useUI.getState().openTodo(data.todos[0].todo.id);
      onDone?.();
    }
  };
  const nothing = data && data.notes.length === 0 && data.todos.length === 0 && folderHits.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-6 pb-16 pt-7">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && openFirst()}
          placeholder="Search notes, folders and todos…"
          className="h-10 w-full rounded border border-input bg-transparent pl-9 pr-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          data-testid="search-input"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Select value={filters.kind} onChange={(v) => set("kind", v)} options={[{ value: "all", label: "Notes & todos" }, { value: "notes", label: "Notes only" }, { value: "todos", label: "Todos only" }]} aria-label="Type" />
        <Select<string>
          value={filters.folderPath}
          onChange={(v) => set("folderPath", v)}
          options={[{ value: "", label: "All folders" }, ...folders.map((f) => ({ value: f.path, label: f.path }))]}
          className="max-w-52"
          aria-label="Folder"
        />
        {filters.kind !== "notes" && (
          <>
            <Select<string>
              value={String(filters.priority ?? "")}
              onChange={(v) => set("priority", v ? (Number(v) as 1) : null)}
              options={[{ value: "", label: "Any priority" }, { value: "1", label: "P1" }, { value: "2", label: "P2" }, { value: "3", label: "P3" }, { value: "4", label: "P4" }]}
              aria-label="Priority"
            />
            <Select<string>
              value={filters.status ?? ""}
              onChange={(v) => set("status", (v || null) as TodoStatus | "open" | null)}
              options={[{ value: "", label: "Any status" }, { value: "open", label: "Open" }, ...(Object.keys(STATUS_LABELS) as TodoStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))]}
              aria-label="Status"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Due
              <DatePicker value={filters.dueFrom} onChange={(v) => set("dueFrom", v)} placeholder="Any" className="h-8 border-input text-foreground" aria-label="Due from" />
              –
              <DatePicker value={filters.dueTo} onChange={(v) => set("dueTo", v)} placeholder="Any" className="h-8 border-input text-foreground" aria-label="Due to" />
            </label>
          </>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X /> Clear filters
          </Button>
        )}
      </div>

      <div className="mt-6">
        {!hasQuery && <p className="py-10 text-center text-sm text-muted-foreground">Type to search all notes, folders and todos, or pick a filter.</p>}
        {hasQuery && nothing && (
          <p className="py-10 text-center text-sm text-muted-foreground">No results.</p>
        )}
        {data && data.notes.length > 0 && (
          <Section title="Notes" count={data.notes.length}>
            {data.notes.map(({ note, snippet }) => (
              <button key={note.id} {...noteLinkProps(note.id, onDone)} className="block w-full rounded px-2 py-2 text-left hover:bg-muted" data-testid="search-note-hit">
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  <FileText className="size-4 text-muted-foreground" /> {note.title}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{dirname(note.path)}</span>
                </div>
                {snippet && (
                  <p className="mt-0.5 line-clamp-2 pl-6 text-xs text-muted-foreground">
                    <Snippet text={snippet} />
                  </p>
                )}
              </button>
            ))}
          </Section>
        )}
        {folderHits.length > 0 && (
          <Section title="Folders" count={folderHits.length}>
            {folderHits.map((f) => (
              <button key={f.id} onClick={() => showFolder(f.id)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[13.5px] hover:bg-muted" data-testid="search-folder-hit">
                <FolderLabel folderId={f.id} className="font-medium [&_svg]:size-4" />
                {dirname(f.path) && <span className="ml-auto text-xs text-muted-foreground">{dirname(f.path)}</span>}
              </button>
            ))}
          </Section>
        )}
        {data && data.todos.length > 0 && (
          <Section title="Todos" count={data.todos.length}>
            {/* Opening a todo (but not ticking its checkbox) counts as "done" for the floating search. */}
            <div onClick={(e) => onDone && !(e.target as HTMLElement).closest("[role=checkbox], button[aria-label]") && onDone()}>
              {data.todos.map(({ todo }) => (
                <TodoRow key={todo.id} todo={todo} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
