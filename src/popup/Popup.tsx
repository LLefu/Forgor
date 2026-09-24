import { useEffect, useRef, useState } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { FilePlus, ListTodo, Search, FileText, Circle, CheckCircle2, ArrowLeft } from "lucide-react";
import { bootPopup } from "@/app/boot";
import { queryClient } from "@/app/queries";
import { useUI } from "@/app/store";
import { useApplyTheme } from "@/app/theme";
import { EVT, hidePopup, notifyMain, showMain } from "@/app/hotkey";
import { isTauri } from "@/platform/tauri";
import { createNote } from "@/data/notes";
import { search } from "@/data/search";
import { QuickAddForm } from "@/features/todos/QuickAdd";
import { Snippet } from "@/features/search/SearchView";
import { dirname } from "@/lib/paths";
import { cn } from "@/lib/utils";

type Mode = "menu" | "todo" | "search";

export function Popup() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initSettings = useUI((s) => s.initSettings);
  useApplyTheme();

  useEffect(() => {
    bootPopup()
      .then((s) => {
        initSettings(s);
        setReady(true);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [initSettings]);

  if (error) return <div className="p-4 text-sm text-destructive">{error}</div>;
  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <PopupBody />
    </QueryClientProvider>
  );
}

async function done(event?: string, payload?: string) {
  if (event) await notifyMain(event, payload);
  await notifyMain(EVT.dataChanged);
  if (event === EVT.openNote || event === EVT.openTodo) await showMain();
  await hidePopup();
}

function PopupBody() {
  const [mode, setMode] = useState<Mode>("menu");

  // Each time the popup is summoned: fresh data, back to the menu.
  useEffect(() => {
    if (!isTauri()) return;
    let off = () => {};
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen(EVT.popupShown, () => {
        setMode("menu");
        void queryClient.invalidateQueries();
      }).then((o) => (off = o)),
    );
    return () => off();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mode === "menu") void hidePopup();
        else setMode("menu");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border bg-background" data-testid="popup">
      {mode === "menu" && <Menu onPick={setMode} />}
      {mode === "todo" && (
        <div className="p-4">
          <Back onClick={() => setMode("menu")} title="New todo" />
          <QuickAddForm defaults={{}} onDone={(id) => (id ? done() : setMode("menu"))} />
        </div>
      )}
      {mode === "search" && <SearchPane onBack={() => setMode("menu")} />}
    </div>
  );
}

function Back({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> {title}
    </button>
  );
}

function Menu({ onPick }: { onPick: (m: Mode) => void }) {
  const newNote = async () => {
    const n = await createNote("");
    await done(EVT.openNote, n.id);
  };
  const items = [
    { key: "1", icon: FilePlus, label: "New note", hint: "Creates an untitled note and opens it", action: newNote },
    { key: "2", icon: ListTodo, label: "New todo", hint: "Quick add a todo", action: () => onPick("todo") },
    { key: "3", icon: Search, label: "Search notes & todos", hint: "Find and open anything", action: () => onPick("search") },
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const byKey = items.find((i) => i.key === e.key);
      if (byKey || ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) e.preventDefault(); // don't leak into the next input
      if (byKey) return void byKey.action();
      if (e.key === "ArrowDown") setIndex((i) => (i + 1) % items.length);
      if (e.key === "ArrowUp") setIndex((i) => (i - 1 + items.length) % items.length);
      if (e.key === "Enter") void items[index].action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="p-2">
      <p className="px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">Work Notes</p>
      {items.map((it, i) => (
        <button
          key={it.key}
          onClick={() => void it.action()}
          onMouseEnter={() => setIndex(i)}
          className={cn("flex w-full items-center gap-3 rounded px-3 py-2.5 text-left", i === index && "bg-muted")}
        >
          <it.icon className="size-5 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-medium">{it.label}</div>
            <div className="text-xs text-muted-foreground">{it.hint}</div>
          </div>
          <kbd className="rounded-sm border px-1.5 text-[11px] text-muted-foreground">{it.key}</kbd>
        </button>
      ))}
    </div>
  );
}

function SearchPane({ onBack }: { onBack: () => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { data } = useQuery({ queryKey: ["popup-search", q], queryFn: () => search(q), placeholderData: (p) => p });
  useEffect(() => input.current?.focus(), []);

  return (
    <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3">
        <button onClick={onBack} aria-label="Back" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
        <Command.Input ref={input} value={q} onValueChange={setQ} placeholder="Search notes and todos…" className="h-11 flex-1 bg-transparent text-sm outline-none" />
      </div>
      <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
        {q && data && !data.notes.length && !data.todos.length && <Command.Empty className="p-4 text-center text-xs text-muted-foreground">No results</Command.Empty>}
        {data?.notes.map(({ note, snippet }) => (
          <Command.Item
            key={note.id}
            value={`n:${note.id}`}
            onSelect={() => done(EVT.openNote, note.id)}
            className="cursor-default rounded-sm px-2 py-1.5 data-[selected=true]:bg-muted"
          >
            <div className="flex items-center gap-2 text-[13px]">
              <FileText className="size-4 text-muted-foreground" /> {note.title}
              <span className="ml-auto text-xs text-muted-foreground">{dirname(note.path)}</span>
            </div>
            {snippet && (
              <p className="truncate pl-6 text-xs text-muted-foreground">
                <Snippet text={snippet} />
              </p>
            )}
          </Command.Item>
        ))}
        {data?.todos.map(({ todo }) => (
          <Command.Item
            key={todo.id}
            value={`t:${todo.id}`}
            onSelect={() => done(EVT.openTodo, todo.id)}
            className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-muted"
          >
            {todo.status === "done" ? <CheckCircle2 className="size-4 text-muted-foreground" /> : <Circle className="size-4 text-muted-foreground" />}
            <span className="truncate">{todo.title}</span>
            {todo.dueDate && <span className="ml-auto text-xs text-muted-foreground">{todo.dueDate}</span>}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
