import { useMemo } from "react";
import { format } from "date-fns";
import { ListTodo } from "lucide-react";
import { useTodos } from "@/app/queries";
import { useUI } from "@/app/store";
import { bucketTodos, isOpen, todayStr } from "@/lib/dates";
import { PageHeader, Section } from "@/features/todos/TodosPage";
import { TodoRow } from "@/features/todos/TodoRow";
import { InlineAdd } from "@/features/todos/InlineAdd";
import { PluginTodayCards, PluginTodaySections } from "@/plugins/views";
import { TodayCard } from "./TodayCard";

/**
 * Everything for today: numbers on top (todos, and what enabled plugins add:
 * open tickets, pull requests…), the plugins' short "needs attention" lists,
 * then today's todos.
 */
export function TodayPage() {
  const { data: todos = [] } = useTodos();
  const upcomingDays = useUI((s) => s.settings.upcomingDays);
  const today = todayStr();
  const buckets = useMemo(() => bucketTodos(todos, today, upcomingDays), [todos, today, upcomingDays]);
  const completedToday = todos.filter((t) => t.status === "done" && !t.parentId && t.completedAt?.slice(0, 10) === today);
  const withoutFolder = todos.filter((t) => isOpen(t) && !t.folderId && !t.parentId).length;
  const due = buckets.overdue.length + buckets.today.length;
  const openTotal = todos.filter((t) => isOpen(t) && !t.parentId).length;

  return (
    <div className="mx-auto max-w-3xl pb-16" data-testid="today-page">
      <PageHeader title="Today" subtitle={format(new Date(), "EEEE d MMMM")} />
      <div className="px-6">
        <div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2" data-testid="today-cards">
          <TodayCard
            icon={ListTodo}
            label="Todos"
            count={due}
            detail={
              <>
                {buckets.overdue.length ? <span className="text-destructive">{buckets.overdue.length} overdue</span> : "due today"} · {openTotal} total
              </>
            }
            target={{ kind: "all" }}
            testId="today-card-todos"
          />
          <PluginTodayCards />
        </div>

        <PluginTodaySections />

        {buckets.overdue.length > 0 && (
          <Section title="Overdue" count={buckets.overdue.length} tone="danger" collapsible>
            {buckets.overdue.map((t) => (
              <TodoRow key={t.id} todo={t} />
            ))}
          </Section>
        )}
        <Section title="Todos for today" count={buckets.today.length}>
          {buckets.today.map((t) => (
            <TodoRow key={t.id} todo={t} showDate={false} />
          ))}
          <InlineAdd defaults={{ dueDate: today }} />
        </Section>
        {completedToday.length > 0 && (
          <Section title="Completed today" count={completedToday.length} collapsible>
            {completedToday.map((t) => (
              <TodoRow key={t.id} todo={t} showDate={false} />
            ))}
          </Section>
        )}
        {withoutFolder > 0 && <WithoutFolder count={withoutFolder} />}
      </div>
    </div>
  );
}

/** Todos without a folder (the old Inbox): a nudge to sort them, opening Todos grouped by folder. */
function WithoutFolder({ count }: { count: number }) {
  const open = () => {
    const ui = useUI.getState();
    void ui.updateSetting("allTasksSort", "folder");
    ui.setView({ kind: "all" });
  };
  return (
    <button onClick={open} className="px-2 text-xs text-muted-foreground hover:text-primary" data-testid="today-without-folder">
      {count} {count === 1 ? "todo" : "todos"} without a folder: sort them in Todos
    </button>
  );
}
