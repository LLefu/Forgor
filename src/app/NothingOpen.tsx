import { FilePlus, Search, Sun, ListTodo } from "lucide-react";
import { useUI } from "./store";
import * as notes from "@/data/notes";
import { shortcutLabel } from "@/lib/keys";

/** Shown when every tab is closed. */
export function NothingOpen() {
  const setView = useUI((s) => s.setView);
  const openQuickAdd = useUI((s) => s.openQuickAdd);

  const actions = [
    {
      icon: FilePlus,
      label: "New note",
      run: async () => {
        const n = await notes.createNote("");
        setView({ kind: "note", id: n.id });
        useUI.getState().requestRename(`n:${n.id}`);
      },
    },
    { icon: ListTodo, label: "New todo", hint: shortcutLabel("Mod+Shift+A"), run: () => openQuickAdd() },
    { icon: Search, label: "Search", hint: shortcutLabel("Mod+Shift+F"), run: () => useUI.getState().setSearchOverlay(true) },
    { icon: Sun, label: "Today", run: () => setView({ kind: "today" }) },
  ];

  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="nothing-open">
      <div className="w-64 text-center">
        <p className="text-sm font-medium text-foreground/80">Nothing open</p>
        <p className="mt-1 text-xs text-muted-foreground">Pick a note in the explorer, or:</p>
        <div className="mt-4 space-y-px text-left">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => void a.run()}
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-[13px] text-foreground/85 hover:bg-muted"
            >
              <a.icon className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left">{a.label}</span>
              {a.hint && <span className="text-[11px] text-muted-foreground">{a.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
