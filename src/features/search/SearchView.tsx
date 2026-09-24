import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, FileText, X } from "lucide-react";
import { search, EMPTY_FILTERS, HL_END, HL_START, type SearchFilters } from "@/data/search";
import { useFolders } from "@/app/queries";
import { useUI } from "@/app/store";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TodoRow } from "@/features/todos/TodoRow";
import { Section } from "@/features/todos/TodosPage";
import { STATUS_LABELS, type TodoStatus } from "@/data/types";
import { dirname } from "@/lib/paths";

/** Renders a snippet with \u0001…\u0002 highlight markers as <mark>, without HTML injection. */
export function Snippet({ text: raw }: { text: string }) {
  // Strip markdown syntax (keeps highlight markers intact) so snippets read as plain text.
  const text = raw
    .replace(/\s?\^t-[a-z0-9]+/g, "")
    .replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
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
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const { data: folders = [] } = useFolders();
  const setView = useUI((s) => s.setView);
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

  return (
    <div className="mx-auto max-w-3xl px-6 pb-16 pt-7">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search notes and todos…"
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
              <input type="date" value={filters.dueFrom ?? ""} onChange={(e) => set("dueFrom", e.target.value || null)} className="h-8 rounded border border-input bg-transparent px-1.5 text-sm text-foreground" aria-label="Due from" />
              –
              <input type="date" value={filters.dueTo ?? ""} onChange={(e) => set("dueTo", e.target.value || null)} className="h-8 rounded border border-input bg-transparent px-1.5 text-sm text-foreground" aria-label="Due to" />
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
        {!hasQuery && <p className="py-10 text-center text-sm text-muted-foreground">Type to search the contents of all notes and todos, or pick a filter.</p>}
        {hasQuery && data && data.notes.length === 0 && data.todos.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No results.</p>
        )}
        {data && data.notes.length > 0 && (
          <Section title="Notes" count={data.notes.length}>
            {data.notes.map(({ note, snippet }) => (
              <button key={note.id} onClick={() => setView({ kind: "note", id: note.id })} className="block w-full rounded px-2 py-2 text-left hover:bg-muted" data-testid="search-note-hit">
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
        {data && data.todos.length > 0 && (
          <Section title="Todos" count={data.todos.length}>
            {data.todos.map(({ todo }) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
