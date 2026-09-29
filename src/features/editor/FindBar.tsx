import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { NoteEditorHandle } from "./NoteEditor";

/**
 * Ctrl/⌘+F inside a note. Enter / Shift+Enter jump to the next / previous
 * match, Escape closes and puts the cursor back in the note.
 */
export function FindBar({ editor }: { editor: React.RefObject<NoteEditorHandle | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ index: 0, count: 0 });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onFind = () => {
      const selected = editor.current?.selectedText().trim();
      setOpen(true);
      if (selected && !selected.includes("\n")) {
        setQuery(selected);
        setPos(editor.current?.find({ query: selected }) ?? { index: 0, count: 0 });
      }
      setTimeout(() => input.current?.select(), 0);
    };
    window.addEventListener("find-in-note", onFind);
    return () => window.removeEventListener("find-in-note", onFind);
  }, [editor]);

  const close = () => {
    setOpen(false);
    editor.current?.find({ query: "" });
    editor.current?.focus();
  };

  if (!open) return null;
  return (
    <div className="relative z-10 h-0">
      <div
        className="absolute right-4 top-2 flex items-center gap-1 rounded border bg-popover p-1 pl-2 shadow-lg"
        role="search"
        data-testid="find-bar"
      >
        <input
          ref={input}
          value={query}
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value);
            setPos(editor.current?.find({ query: e.target.value }) ?? { index: 0, count: 0 });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setPos(editor.current?.find({ step: e.shiftKey ? -1 : 1 }) ?? pos);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          placeholder="Find in note"
          className="h-7 w-52 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          aria-label="Find in note"
          data-testid="find-input"
        />
        <span className="min-w-12 text-right text-xs tabular-nums text-muted-foreground" data-testid="find-count">
          {query ? (pos.count ? `${pos.index}/${pos.count}` : "No results") : ""}
        </span>
        <button
          className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          disabled={!pos.count}
          onClick={() => setPos(editor.current?.find({ step: -1 }) ?? pos)}
          aria-label="Previous match"
          title="Previous (Shift+Enter)"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          disabled={!pos.count}
          onClick={() => setPos(editor.current?.find({ step: 1 }) ?? pos)}
          aria-label="Next match"
          title="Next (Enter)"
        >
          <ChevronDown className="size-4" />
        </button>
        <button className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={close} aria-label="Close find" title="Close (Esc)">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
