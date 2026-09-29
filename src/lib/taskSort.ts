import { addDaysStr, compareTodos } from "./dates";
import type { Folder, Todo } from "@/data/types";
import { PRIORITY_LABELS } from "@/data/types";

export type TaskSort = "due" | "priority" | "folder" | "created" | "title";

export const TASK_SORTS: { value: TaskSort; label: string }[] = [
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "folder", label: "Folder" },
  { value: "created", label: "Newest first" },
  { value: "title", label: "Title (A–Z)" },
];

export interface TaskGroup {
  key: string;
  title: string | null; // null = no heading (flat list)
  tone?: "danger";
  folderId?: string | null;
  todos: Todo[];
}

const byDue = (a: Todo, b: Todo) => {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1; // undated last
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return compareTodos(a, b);
};

/** Group + sort the "All tasks" list. Only top-level todos (subtasks show inside their parent). */
export function groupTasks(todos: Todo[], sort: TaskSort, folders: Folder[], today: string): TaskGroup[] {
  const list = todos.filter((t) => !t.parentId);
  switch (sort) {
    case "due": {
      const tomorrow = addDaysStr(today, 1);
      const weekEnd = addDaysStr(today, 7);
      const buckets: TaskGroup[] = [
        { key: "overdue", title: "Overdue", tone: "danger", todos: [] },
        { key: "today", title: "Today", todos: [] },
        { key: "tomorrow", title: "Tomorrow", todos: [] },
        { key: "week", title: "Next 7 days", todos: [] },
        { key: "later", title: "Later", todos: [] },
        { key: "none", title: "No date", todos: [] },
      ];
      const [overdue, todayB, tomorrowB, week, later, none] = buckets;
      for (const t of [...list].sort(byDue)) {
        const d = t.dueDate;
        if (!d) none.todos.push(t);
        else if (d < today && t.status !== "done") overdue.todos.push(t);
        else if (d <= today) todayB.todos.push(t);
        else if (d === tomorrow) tomorrowB.todos.push(t);
        else if (d <= weekEnd) week.todos.push(t);
        else later.todos.push(t);
      }
      return buckets.filter((b) => b.todos.length);
    }
    case "priority":
      return ([1, 2, 3, 4] as const)
        .map((p) => ({ key: `p${p}`, title: PRIORITY_LABELS[p], todos: list.filter((t) => t.priority === p).sort(byDue) }))
        .filter((g) => g.todos.length);
    case "folder": {
      const path = (id: string | null) => folders.find((f) => f.id === id)?.path ?? null;
      const groups = new Map<string, TaskGroup>();
      for (const t of list) {
        const p = t.folderId ? path(t.folderId) : null;
        const key = p ?? "";
        if (!groups.has(key)) groups.set(key, { key: key || "inbox", title: p ?? "Inbox (no folder)", folderId: p ? t.folderId : null, todos: [] });
        groups.get(key)!.todos.push(t);
      }
      return [...groups.entries()]
        .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { numeric: true })))
        .map(([, g]) => ({ ...g, todos: g.todos.sort(byDue) }));
    }
    case "created":
      return [{ key: "all", title: null, todos: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }];
    case "title":
      return [{ key: "all", title: null, todos: [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })) }];
  }
}
