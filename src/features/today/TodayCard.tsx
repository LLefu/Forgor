import type { ReactNode } from "react";
import { useUI, type View } from "@/app/store";
import { cn } from "@/lib/utils";
import { Section } from "@/features/todos/TodosPage";

/**
 * A number on the Today page (open tickets, reviews waiting…); clicking opens
 * `target`. `count` undefined: still loading.
 */
export function TodayCard({
  icon: Icon,
  label,
  count,
  detail,
  tone,
  target,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number | undefined;
  /** A line under the number ("2 overdue"). */
  detail?: ReactNode;
  /** "danger" colors the detail red. */
  tone?: "danger";
  target: View;
  testId?: string;
}) {
  const setView = useUI((s) => s.setView);
  return (
    <button
      onClick={() => setView(target)}
      className="flex min-w-0 flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
      data-testid={testId ?? "today-card"}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className={cn("text-2xl font-semibold leading-none tabular-nums", count === undefined && "text-muted-foreground/50")} data-testid="today-card-count">
        {count ?? "–"}
      </span>
      <span className={cn("truncate text-xs", tone === "danger" ? "text-destructive" : "text-muted-foreground")}>{detail ?? " "}</span>
    </button>
  );
}

/**
 * A short list on the Today page (shows nothing when empty): the first `max`
 * rows, then "N more" opening `target`.
 */
export function TodayList({ title, rows, max = 5, target, testId }: { title: string; rows: ReactNode[]; max?: number; target: View; testId?: string }) {
  const setView = useUI((s) => s.setView);
  if (rows.length === 0) return null;
  return (
    <div data-testid={testId}>
      <Section title={title} count={rows.length} collapsible>
        {rows.slice(0, max)}
        {rows.length > max && (
          <button onClick={() => setView(target)} className="px-2 py-1 text-xs text-muted-foreground hover:text-primary">
            {rows.length - max} more
          </button>
        )}
      </Section>
    </div>
  );
}
