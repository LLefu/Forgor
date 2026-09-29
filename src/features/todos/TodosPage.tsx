import { useMemo, useState } from "react";
import { Plus, ChevronDown } from "lucide-react";
import { useTodos } from "@/app/queries";
import { useUI } from "@/app/store";
import { bucketTodos, isOpen, todayStr } from "@/lib/dates";
import type { Todo } from "@/data/types";
import { TodoRow } from "./TodoRow";
import { InlineAdd } from "./InlineAdd";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export function PageHeader({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 px-8 pb-3 pt-7">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          {icon}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

export function Section({
  title,
  count,
  tone,
  children,
  collapsible,
  heading,
}: {
  title: string;
  /** Custom heading content (e.g. a colored folder label); replaces `title` visually. */
  heading?: React.ReactNode;
  count?: number;
  tone?: "danger";
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-5">
      <button
        className={cn("mb-1 flex w-full items-center gap-1.5 border-b pb-1 text-left text-xs font-semibold", tone === "danger" ? "text-destructive" : "text-foreground/80")}
        onClick={() => collapsible && setOpen(!open)}
        disabled={!collapsible}
      >
        {collapsible && <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />}
        {heading ?? title}
        {count !== undefined && <span className="font-normal text-muted-foreground">{count}</span>}
      </button>
      {open && children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function TodosPage({ kind }: { kind: "inbox" | "today" }) {
  const { data: todos = [] } = useTodos();
  const upcomingDays = useUI((s) => s.settings.upcomingDays);
  const today = todayStr();
  const buckets = useMemo(() => bucketTodos(todos, today, upcomingDays), [todos, today, upcomingDays]);

  if (kind === "inbox") {
    const open = todos.filter((t) => isOpen(t) && !t.folderId && !t.parentId).sort(inboxOrder);
    const doneToday = todos.filter((t) => t.status === "done" && !t.folderId && !t.parentId);
    return (
      <div className="mx-auto max-w-3xl pb-16">
        <PageHeader title="Inbox" subtitle="Todos without a folder. Sort them into a project when you have a moment." />
        <div className="px-6">
          <InlineAdd defaults={{}} />
          {open.length === 0 ? <Empty>Inbox zero 🎉</Empty> : open.map((t) => <TodoRow key={t.id} todo={t} />)}
          {doneToday.length > 0 && (
            <div className="mt-6">
              <Section title="Completed" count={doneToday.length} collapsible>
                {doneToday.map((t) => (
                  <TodoRow key={t.id} todo={t} />
                ))}
              </Section>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (kind === "today") {
    const completedToday = todos.filter((t) => t.status === "done" && !t.parentId && t.completedAt?.slice(0, 10) === today);
    return (
      <div className="mx-auto max-w-3xl pb-16">
        <PageHeader title="Today" subtitle={format(new Date(), "EEEE d MMMM")} />
        <div className="px-6">
          {buckets.overdue.length > 0 && (
            <Section title="Overdue" count={buckets.overdue.length} tone="danger" collapsible>
              {buckets.overdue.map((t) => (
                <TodoRow key={t.id} todo={t} />
              ))}
            </Section>
          )}
          <Section title="Today" count={buckets.today.length}>
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
        </div>
      </div>
    );
  }

  return null;
}

function inboxOrder(a: Todo, b: Todo) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.sortOrder - b.sortOrder;
}

export function AddTodoButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-primary">
      <Plus className="size-4" /> Add todo
    </button>
  );
}
