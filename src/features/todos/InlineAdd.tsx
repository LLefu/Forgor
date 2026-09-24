import { useState } from "react";
import { Plus } from "lucide-react";
import { createTodo, type TodoInput } from "@/data/todos";

/** A lightweight "Add todo" line: type a title, press Enter, keep going. */
export function InlineAdd({ defaults, placeholder = "Add todo" }: { defaults: TodoInput; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  const submit = async () => {
    if (!title.trim()) return;
    await createTodo({ ...defaults, title });
    setTitle("");
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-[13.5px] text-muted-foreground hover:text-primary"
        data-testid="inline-add"
      >
        <Plus className="size-4" /> {placeholder}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <Plus className="size-4 text-muted-foreground" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") {
            setTitle("");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setEditing(false);
        }}
        placeholder="Todo title, Enter to add, Esc to close"
        className="h-7 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
        data-testid="inline-add-input"
      />
    </div>
  );
}
