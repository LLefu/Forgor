import { forwardRef, useImperativeHandle, useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, CircleCheck, Circle } from "lucide-react";
import type { Folder, NoteMeta, Todo } from "@/data/types";
import type { MentionSuggestState } from "./linkPlugins";
import { basename, dirname } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { FolderLabel } from "@/features/folder/folderColors";

export interface MentionSuggestHandle {
  onKey: (key: string) => boolean;
}

export type MentionPick =
  | { kind: "note" | "todo" | "folder"; id: string; title: string }
  | { kind: "create-note"; title: string };

interface Item {
  key: string;
  group: "Notes" | "Todos" | "Folders";
  pick: MentionPick;
  label: string;
  hint: string;
  done?: boolean;
}

/**
 * Floating list shown while typing "@query": notes, todos and folders.
 * It hides itself when nothing matches a multi-word query, so typing on
 * ("@ the office") is never blocked.
 */
export const MentionSuggest = forwardRef<
  MentionSuggestHandle,
  { state: MentionSuggestState; notes: NoteMeta[]; todos: Todo[]; folders: Folder[]; onlyNotes: boolean; onPick: (p: MentionPick) => void }
>(function MentionSuggest({ state, notes, todos, folders, onlyNotes, onPick }, ref) {
  const [index, setIndex] = useState(0);
  const q = state.query.trim().toLowerCase();

  const items = useMemo(() => {
    // 0 = title starts with the query, 1 = title contains it, 2 = only the folder path does, -1 = no match.
    const score = (title: string, path = "") => {
      if (!q) return 0;
      const t = title.toLowerCase();
      if (t.startsWith(q)) return 0;
      if (t.includes(q)) return 1;
      return path.toLowerCase().includes(q) ? 2 : -1;
    };
    type Scored = Item & { score: number; order: number };
    const noteItems: Scored[] = notes
      .map((n) => ({ n, sc: score(n.title, n.path) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => a.sc - b.sc || (q ? 0 : b.n.updatedAt.localeCompare(a.n.updatedAt)))
      .slice(0, onlyNotes ? 10 : q ? 6 : 4)
      .map(({ n, sc }) => ({ key: `n:${n.id}`, group: "Notes", pick: { kind: "note", id: n.id, title: n.title }, label: n.title, hint: dirname(n.path), score: sc, order: 0 }));
    const todoItems: Scored[] = onlyNotes
      ? []
      : todos
          .filter((t) => !t.deletedAt && score(t.title) >= 0)
          .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || score(a.title) - score(b.title))
          .slice(0, q ? 6 : 4)
          .map((t) => ({ key: `t:${t.id}`, group: "Todos", pick: { kind: "todo", id: t.id, title: t.title }, label: t.title, hint: q ? "todo" : "", done: t.status === "done", score: score(t.title), order: 1 }));
    const folderItems: Scored[] = onlyNotes
      ? []
      : folders
          .filter((f) => score(basename(f.path)) >= 0)
          .sort((a, b) => score(basename(a.path)) - score(basename(b.path)))
          .slice(0, q ? 4 : 3)
          .map((f) => ({ key: `f:${f.id}`, group: "Folders", pick: { kind: "folder", id: f.id, title: basename(f.path) }, label: basename(f.path), hint: dirname(f.path) || (q ? "folder" : ""), score: score(basename(f.path)), order: 2 }));
    // Without a query: grouped (recent notes, todos, folders). With one: best matches first, whatever their kind.
    const all: Item[] = [...noteItems, ...todoItems, ...folderItems].sort((a, b) => (q ? a.score - b.score : 0) || a.order - b.order);
    // Offer to create a note, unless a multi-word query matches nothing (then you are just typing).
    const exact = notes.some((n) => n.title.toLowerCase() === q);
    if (q && !exact && (all.length > 0 || !q.includes(" "))) {
      all.push({ key: "__new", group: "Notes", pick: { kind: "create-note", title: state.query.trim() }, label: `Create note “${state.query.trim()}”`, hint: "" });
    }
    return all;
  }, [notes, todos, folders, q, onlyNotes, state.query]);

  useEffect(() => setIndex(0), [q]);

  useImperativeHandle(ref, () => ({
    onKey: (key) => {
      if (!items.length) return false;
      if (key === "ArrowDown") setIndex((i) => (i + 1) % items.length);
      else if (key === "ArrowUp") setIndex((i) => (i - 1 + items.length) % items.length);
      else if (key === "Enter" || key === "Tab") onPick(items[Math.min(index, items.length - 1)].pick);
      else return false;
      return true;
    },
  }));

  if (!state.coords || !items.length) return null;
  const below = state.coords.bottom + 320 < window.innerHeight;
  return createPortal(
    <div
      className="fixed z-50 max-h-80 w-80 overflow-y-auto rounded border bg-popover p-1 text-[13px] shadow-lg"
      style={below ? { left: state.coords.left, top: state.coords.bottom + 4 } : { left: state.coords.left, bottom: window.innerHeight - state.coords.bottom + 24 }}
      data-testid="mention-suggest"
    >
      {items.map((it, i) => (
        <div key={it.key}>
          {!q && (i === 0 || items[i - 1].group !== it.group) && it.pick.kind !== "create-note" && (
            <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{it.group}</div>
          )}
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it.pick);
            }}
            onMouseEnter={() => setIndex(i)}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left", i === index && "bg-muted")}
            data-testid="mention-option"
          >
            {it.pick.kind === "create-note" ? (
              <Plus className="size-4 shrink-0 text-muted-foreground" />
            ) : it.pick.kind === "folder" ? (
              <FolderLabel folderId={it.pick.id} className="min-w-0 [&_svg]:size-4" />
            ) : it.pick.kind === "todo" ? (
              it.done ? (
                <CircleCheck className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            )}
            {it.pick.kind !== "folder" && <span className={cn("truncate", it.done && "text-muted-foreground line-through")}>{it.label}</span>}
            {it.hint && <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{it.hint}</span>}
          </button>
        </div>
      ))}
      <div className="border-t px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">↑↓ to choose · Enter to link · Esc to dismiss</div>
    </div>,
    document.body,
  );
});
