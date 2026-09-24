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
  /** CSS color for the border, e.g. a priority color. */
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
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center border-[1.5px] transition-colors",
        round ? "rounded-full" : "rounded-sm",
        checked ? "border-transparent bg-muted-foreground text-background" : "hover:bg-muted",
        className,
      )}
      style={!checked && color ? { borderColor: color } : undefined}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </button>
  );
}
