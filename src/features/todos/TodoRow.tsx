import { Repeat, FileText, ListTree, Clock, Folder, CircleDashed, Hourglass, Ban } from "lucide-react";
import type { Todo } from "@/data/types";
import { useUI } from "@/app/store";
import { useFolders } from "@/app/queries";
import { setDone } from "@/data/todos";
import { friendlyDate, formatEstimate, todayStr } from "@/lib/dates";
import { basename } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { notesForTodo } from "@/data/todos";
import { useQuery } from "@tanstack/react-query";

export const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--p1)",
  2: "var(--p2)",
  3: "var(--p3)",
  4: "var(--p4)",
};

const STATUS_BADGE = {
  in_progress: { icon: CircleDashed, label: "In progress", cls: "text-primary" },
  waiting: { icon: Hourglass, label: "Waiting", cls: "text-warning" },
  blocked: { icon: Ban, label: "Blocked", cls: "text-destructive" },
} as const;

export function TodoRow({ todo, showDate = true, showFolder = true }: { todo: Todo; showDate?: boolean; showFolder?: boolean }) {
  const openTodo = useUI((s) => s.openTodo);
  const selected = useUI((s) => s.selectedTodoId === todo.id);
  const { data: folders = [] } = useFolders();
  const done = todo.status === "done";
  const today = todayStr();
  const overdue = !!todo.dueDate && todo.dueDate < today && !done;
  const folder = showFolder && todo.folderId ? folders.find((f) => f.id === todo.folderId) : null;
  const badge = todo.status in STATUS_BADGE ? STATUS_BADGE[todo.status as keyof typeof STATUS_BADGE] : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTodo(todo.id)}
      onKeyDown={(e) => e.key === "Enter" && openTodo(todo.id)}
      className={cn(
        "group flex cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 outline-none",
        selected ? "bg-accent" : "hover:bg-muted/70 focus-visible:bg-muted/70",
      )}
      data-testid="todo-row"
      data-title={todo.title}
    >
      <Checkbox
        round
        checked={done}
        color={PRIORITY_COLOR[todo.priority]}
        onChange={(v) => setDone(todo.id, v)}
        className="mt-0.5"
        label={`Complete ${todo.title}`}
      />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[13.5px] leading-5", done && "text-muted-foreground line-through")}>{todo.title}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground empty:hidden">
          {showDate && todo.dueDate && (
            <span className={cn("flex items-center gap-1", overdue && "text-destructive")}>
              {friendlyDate(todo.dueDate, today)}
              {todo.dueTime && ` ${todo.dueTime}`}
            </span>
          )}
          {!showDate && todo.dueTime && <span>{todo.dueTime}</span>}
          {todo.startDate && todo.startDate > today && <span>starts {friendlyDate(todo.startDate, today)}</span>}
          {badge && (
            <span className={cn("flex items-center gap-1", badge.cls)}>
              <badge.icon className="size-3" /> {badge.label}
            </span>
          )}
          {todo.rrule && <Repeat className="size-3" aria-label="Repeats" />}
          {todo.subtaskCount > 0 && (
            <span className="flex items-center gap-1">
              <ListTree className="size-3" /> {todo.subtaskDone}/{todo.subtaskCount}
            </span>
          )}
          {todo.estimateMin ? (
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {formatEstimate(todo.estimateMin)}
            </span>
          ) : null}
          {todo.noteCount > 0 && <NoteBadge todoId={todo.id} count={todo.noteCount} />}
          {folder && (
            <span className="flex items-center gap-1">
              <Folder className="size-3" /> {basename(folder.path)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Note indicator: icon + count, hover shows the linked note titles. */
function NoteBadge({ todoId, count }: { todoId: string; count: number }) {
  const { data: linked } = useQuery({ queryKey: ["notesForTodo", todoId], queryFn: () => notesForTodo(todoId) });
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          {(linked ?? []).map((n) => (
            <div key={n.id} className="truncate">
              {n.title}
            </div>
          ))}
        </div>
      }
    >
      <span className="flex items-center gap-1 text-primary" data-testid="note-badge">
        <FileText className="size-3" /> {count}
      </span>
    </Tooltip>
  );
}
