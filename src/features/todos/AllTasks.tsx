import { useMemo } from "react";
import { useFolders, useTodos } from "@/app/queries";
import { useUI } from "@/app/store";
import { groupTasks, TASK_SORTS, type TaskSort } from "@/lib/taskSort";
import { isOpen, todayStr } from "@/lib/dates";
import { PageHeader, Section } from "./TodosPage";
import { TodoRow } from "./TodoRow";
import { InlineAdd } from "./InlineAdd";
import { FolderLabel } from "@/features/folder/folderColors";
import { cn } from "@/lib/utils";

/** Every todo in one place, with basic sorting (replaces the old Upcoming view). */
export function AllTasks() {
  const { data: todos = [] } = useTodos();
  const { data: folders = [] } = useFolders();
  const sort = useUI((s) => s.settings.allTasksSort);
  const showDone = useUI((s) => s.settings.allTasksShowDone);
  const update = useUI((s) => s.updateSetting);
  const today = todayStr();

  const visible = useMemo(() => todos.filter((t) => isOpen(t) || (showDone && t.status === "done")), [todos, showDone]);
  const groups = useMemo(() => groupTasks(visible, sort, folders, today), [visible, sort, folders, today]);
  const count = visible.filter((t) => !t.parentId).length;

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="All tasks" subtitle={`${count} ${count === 1 ? "task" : "tasks"}`}>
        <div className="flex items-center gap-3 text-sm" data-testid="all-tasks-controls">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showDone} onChange={(e) => update("allTasksShowDone", e.target.checked)} />
            Show completed
          </label>
          <div className="flex rounded border p-0.5" role="radiogroup" aria-label="Sort by">
            {TASK_SORTS.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={sort === s.value}
                onClick={() => update("allTasksSort", s.value as TaskSort)}
                className={cn(
                  "rounded-sm px-2 py-1 text-xs",
                  sort === s.value ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>
      <div className="px-6">
        <InlineAdd defaults={{}} />
        {groups.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No tasks. Enjoy the quiet.</p>}
        {groups.map((g) =>
          g.title === null ? (
            <div key={g.key} className="mt-2">
              {g.todos.map((t) => (
                <TodoRow key={t.id} todo={t} />
              ))}
            </div>
          ) : (
            <Section
              key={g.key}
              title={sort === "folder" && g.folderId !== undefined ? "" : g.title}
              heading={sort === "folder" ? <FolderLabel folderId={g.folderId ?? null} fallback={g.title} className="text-xs font-semibold" /> : undefined}
              count={g.todos.length}
              tone={g.tone}
              collapsible
            >
              {g.todos.map((t) => (
                <TodoRow key={t.id} todo={t} showFolder={sort !== "folder"} />
              ))}
            </Section>
          ),
        )}
      </div>
    </div>
  );
}
