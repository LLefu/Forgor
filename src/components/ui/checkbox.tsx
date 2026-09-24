import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({
  checked,
  onChange,
  className,
  color,
  round,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
  /** CSS color for the border and hover fill, e.g. a priority color. */
  color?: string;
  round?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={checked ? "Mark as not done" : "Mark as done"}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      // The hover state is deliberately different from the row hover, so it's clear
      // a click completes the todo instead of opening it: tinted fill + faint check.
      className={cn(
        "group/cb relative flex size-4 shrink-0 items-center justify-center border-[1.5px] transition-colors",
        "before:absolute before:-inset-1.5 before:content-['']", // larger hit area
        round ? "rounded-full" : "rounded-sm",
        checked
          ? "border-transparent bg-muted-foreground text-background hover:opacity-80"
          : "hover:bg-[color-mix(in_srgb,var(--cb)_20%,transparent)] hover:ring-2 hover:ring-[color-mix(in_srgb,var(--cb)_25%,transparent)]",
        className,
      )}
      style={{ "--cb": color ?? "var(--muted-foreground)", ...(!checked ? { borderColor: "var(--cb)" } : {}) } as React.CSSProperties}
    >
      {checked ? (
        <Check className="size-3" strokeWidth={3} />
      ) : (
        <Check className="size-2.5 opacity-0 transition-opacity group-hover/cb:opacity-100" style={{ color: "var(--cb)" }} strokeWidth={3.5} />
      )}
    </button>
  );
}
