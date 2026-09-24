import { addDays, format, parseISO, differenceInCalendarDays } from "date-fns";
import type { Todo } from "@/data/types";

/** Local date as YYYY-MM-DD. */
export function toDateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function todayStr(now: Date = new Date()): string {
  return toDateStr(now);
}

export function addDaysStr(date: string, days: number): string {
  return toDateStr(addDays(parseISO(date), days));
}

/** "Today", "Tomorrow", "Yesterday", weekday within a week, else "12 Oct". */
export function friendlyDate(date: string, today: string = todayStr()): string {
  const diff = differenceInCalendarDays(parseISO(date), parseISO(today));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return format(parseISO(date), "EEEE");
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return format(parseISO(date), sameYear ? "d MMM" : "d MMM yyyy");
}

export function isOpen(t: Todo): boolean {
  return t.status !== "done" && !t.deletedAt && !t.archivedAt;
}

/**
 * The day a todo should surface on: its start date when that lies in the
 * future, otherwise its due date.
 */
export function surfaceDate(t: Todo, today: string): string | null {
  if (t.startDate && t.startDate > today) return t.startDate;
  if (t.startDate && t.startDate <= today) return today;
  return t.dueDate;
}

export interface Buckets {
  overdue: Todo[];
  today: Todo[];
  /** Upcoming, keyed by date (sorted ascending). */
  upcoming: { date: string; todos: Todo[] }[];
}

export function compareTodos(a: Todo, b: Todo): number {
  // Timed items first by time, then priority, then manual order.
  const at = a.dueTime ?? "99:99";
  const bt = b.dueTime ?? "99:99";
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.sortOrder - b.sortOrder;
}

/** Sort Today/Upcoming lists. Only top-level open todos are bucketed. */
export function bucketTodos(todos: Todo[], today: string, upcomingDays: number): Buckets {
  const horizon = addDaysStr(today, upcomingDays);
  const overdue: Todo[] = [];
  const todayList: Todo[] = [];
  const upcoming = new Map<string, Todo[]>();

  for (const t of todos) {
    if (!isOpen(t) || t.parentId) continue;
    if (t.dueDate && t.dueDate < today) {
      overdue.push(t);
      continue;
    }
    const day = surfaceDate(t, today);
    if (!day) continue;
    if (day === today) todayList.push(t);
    else if (day > today && day <= horizon) {
      const list = upcoming.get(day) ?? [];
      list.push(t);
      upcoming.set(day, list);
    }
  }

  overdue.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : compareTodos(a, b)));
  todayList.sort(compareTodos);
  return {
    overdue,
    today: todayList,
    upcoming: [...upcoming.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, list]) => ({ date, todos: list.sort(compareTodos) })),
  };
}

/** True if a completed todo should be auto-archived now. */
export function shouldArchive(t: Todo, now: Date, archiveAfterDays: number): boolean {
  if (t.status !== "done" || !t.completedAt || t.archivedAt || t.deletedAt) return false;
  const ageMs = now.getTime() - new Date(t.completedAt).getTime();
  return ageMs >= archiveAfterDays * 24 * 60 * 60 * 1000;
}

export function formatEstimate(min: number | null): string {
  if (!min) return "";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
