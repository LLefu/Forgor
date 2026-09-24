import { cn } from "@/lib/utils";

/** Native select styled to match: reliable keyboard behaviour, zero overhead. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  ...rest
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        "h-8 rounded border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
