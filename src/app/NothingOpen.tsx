import { FilePlus, Search, Sun, ListTodo } from "lucide-react";
import { APP_SHORTCUTS, useShortcutLabel } from "./shortcuts";

/** Shown when every tab is closed. */
export function NothingOpen() {
  // The same actions as their shortcuts, with their keys
  const run = (id: string) => () => APP_SHORTCUTS.find((s) => s.id === id)!.run();
  const actions = [
    { icon: FilePlus, label: "New note", hint: useShortcutLabel("new-note"), run: run("new-note") },
    { icon: ListTodo, label: "New todo", hint: useShortcutLabel("new-todo"), run: run("new-todo") },
    { icon: Search, label: "Search", hint: useShortcutLabel("quick-open"), run: run("quick-open") },
    { icon: Sun, label: "Today", hint: useShortcutLabel("go-today"), run: run("go-today") },
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
