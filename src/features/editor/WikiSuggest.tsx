import { forwardRef, useImperativeHandle, useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus } from "lucide-react";
import type { NoteMeta } from "@/data/types";
import type { SuggestState } from "./plugins";
import { dirname } from "@/lib/paths";
import { cn } from "@/lib/utils";

export interface WikiSuggestHandle {
  onKey: (key: string) => boolean;
}

/** Floating list of notes shown while typing `[[query`. */
export const WikiSuggest = forwardRef<WikiSuggestHandle, { state: SuggestState; notes: NoteMeta[]; onPick: (title: string) => void }>(
  function WikiSuggest({ state, notes, onPick }, ref) {
    const [index, setIndex] = useState(0);
    const q = state.query.trim().toLowerCase();

    const items = useMemo(() => {
      const matches = notes
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q)))
        .slice(0, 8)
        .map((n) => ({ key: n.id, title: n.title, hint: dirname(n.path), create: false }));
      const exact = notes.some((n) => n.title.toLowerCase() === q);
      if (q && !exact) matches.push({ key: "__new", title: state.query.trim(), hint: "new note", create: true });
      return matches;
    }, [notes, q, state.query]);

    useEffect(() => setIndex(0), [q]);

    useImperativeHandle(ref, () => ({
      onKey: (key) => {
        if (!items.length) return false;
        if (key === "ArrowDown") setIndex((i) => (i + 1) % items.length);
        else if (key === "ArrowUp") setIndex((i) => (i - 1 + items.length) % items.length);
        else if (key === "Enter" || key === "Tab") onPick(items[Math.min(index, items.length - 1)].title);
        else return false;
        return true;
      },
    }));

    if (!state.coords || !items.length) return null;
    return createPortal(
      <div
        className="fixed z-50 w-72 rounded border bg-popover p-1 text-[13px] shadow-lg"
        style={{ left: state.coords.left, top: state.coords.bottom + 4 }}
        data-testid="wiki-suggest"
      >
        {items.map((it, i) => (
          <button
            key={it.key}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it.title);
            }}
            onMouseEnter={() => setIndex(i)}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left", i === index && "bg-muted")}
          >
            {it.create ? <Plus className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
            <span className="truncate">{it.title}</span>
            <span className="ml-auto truncate text-xs text-muted-foreground">{it.hint}</span>
          </button>
        ))}
      </div>,
      document.body,
    );
  },
);
