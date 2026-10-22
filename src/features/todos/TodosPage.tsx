import { useState } from "react";
import { Plus, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-8 pb-3 pt-7">
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

export function AddTodoButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-primary">
      <Plus className="size-4" /> Add todo
    </button>
  );
}
