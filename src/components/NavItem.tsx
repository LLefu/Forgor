import { useUI, type View } from "@/app/store";
import { cn } from "@/lib/utils";

/** An entry in the sidebar (the app's pages, and plugins' via their `sidebar`). */
export function NavItem({
  icon: Icon,
  label,
  count,
  alert,
  hint,
  badge,
  target,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  alert?: boolean;
  hint?: string;
  badge?: React.ReactNode;
  target: View;
  /** Defaults to nav-<kind> (nav-<plugin>-<page> for a plugin page). */
  testId?: string;
}) {
  const setView = useUI((s) => s.setView);
  const active = useUI((s) => !!s.view && (s.view.kind === "plugin" && target.kind === "plugin" ? s.view.plugin === target.plugin && s.view.page === target.page : s.view.kind === target.kind));
  return (
    <button
      onClick={() => setView(target)}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded px-2 text-[13px]",
        active ? "bg-accent font-medium text-accent-foreground" : "text-foreground/85 hover:bg-muted",
      )}
      data-testid={testId ?? (target.kind === "plugin" ? `nav-${target.plugin}-${target.page}` : `nav-${target.kind}`)}
    >
      <Icon className={cn("size-4", active ? "text-accent-foreground" : "text-muted-foreground")} />
      <span className="flex-1 text-left">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      {badge}
      {!!count && <span className={cn("text-xs tabular-nums", alert ? "text-destructive" : "text-muted-foreground")}>{count}</span>}
    </button>
  );
}
