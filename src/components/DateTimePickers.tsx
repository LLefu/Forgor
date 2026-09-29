import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  getISOWeek,
  isSameMonth,
  nextMonday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { friendlyDate, toDateStr, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Forgor's own date and time pickers. The native <input type="date|time">
 * pickers behave differently per OS (on macOS they don't close on an outside
 * click and the time picker barely works), so everything uses these instead.
 * Values: dates are "YYYY-MM-DD", times "HH:mm", null = none.
 */

const triggerCls =
  "inline-flex h-7 items-center gap-1.5 rounded border border-transparent px-1.5 text-[13px] hover:border-input data-[state=open]:border-ring data-[state=open]:bg-accent/60";

export function DatePicker({
  value,
  onChange,
  placeholder = "No date",
  allowClear = true,
  className,
  testId,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  testId?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerCls, !value && "text-muted-foreground", className)} data-testid={testId} aria-label={ariaLabel}>
          <CalendarIcon className="size-3.5 shrink-0 opacity-70" />
          {value ? dateLabel(value) : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[272px] p-2" data-testid="date-picker">
        <CalendarGrid value={value} onPick={pick} />
        <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
          <Quick onClick={() => pick(todayStr())}>Today</Quick>
          <Quick onClick={() => pick(toDateStr(addDays(new Date(), 1)))}>Tomorrow</Quick>
          <Quick onClick={() => pick(toDateStr(nextMonday(new Date())))}>Next Monday</Quick>
          {allowClear && (
            <Quick onClick={() => pick(null)} muted>
              <X className="size-3" /> No date
            </Quick>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "Today, 29 Sep" / "Friday, 2 Oct" for nearby dates, otherwise "2 Nov" or "2 Nov 2027". */
export function dateLabel(v: string): string {
  const f = friendlyDate(v);
  return /^[A-Z][a-z]+$/.test(f) ? `${f}, ${format(parseISO(v), "d MMM")}` : f;
}

function Quick({ onClick, children, muted }: { onClick: () => void; children: React.ReactNode; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground", muted && "text-muted-foreground")}
    >
      {children}
    </button>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function CalendarGrid({ value, onPick }: { value: string | null; onPick: (v: string) => void }) {
  const today = todayStr();
  const [month, setMonth] = useState(() => startOfMonth(value ? parseISO(value) : new Date()));
  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const out: Date[][] = [];
    for (let d = start; d <= end; d = addDays(d, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    return out;
  }, [month]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold">{format(month, "MMMM yyyy")}</span>
        <div className="flex">
          <NavBtn label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft className="size-4" />
          </NavBtn>
          <NavBtn label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="size-4" />
          </NavBtn>
        </div>
      </div>
      <table className="w-full border-collapse text-center text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="w-7 py-1 text-[10px] font-medium">W</th>
            {WEEKDAYS.map((d) => (
              <th key={d} className="py-1 font-medium">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].toISOString()}>
              <td className="text-[10px] text-muted-foreground">{getISOWeek(week[0])}</td>
              {week.map((d) => {
                const ds = toDateStr(d);
                const selected = ds === value;
                return (
                  <td key={ds} className="p-px">
                    <button
                      type="button"
                      onClick={() => onPick(ds)}
                      className={cn(
                        "h-8 w-full rounded-sm text-[13px] tabular-nums",
                        !isSameMonth(d, month) && "text-muted-foreground/60",
                        selected ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted",
                        !selected && ds === today && "font-semibold text-primary",
                      )}
                      aria-label={format(d, "EEEE d MMMM yyyy")}
                      aria-pressed={selected}
                    >
                      {format(d, "d")}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NavBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- time

const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** Accepts "9", "930", "9:30", "09.30", "21:05", "9pm", "9:30am". */
export function parseTime(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function TimePicker({
  value,
  onChange,
  placeholder = "Add time",
  testId,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? "");
  const list = useRef<HTMLDivElement>(null);
  const parsed = parseTime(text);

  useEffect(() => {
    if (!open) return;
    setText(value ?? "");
    // Scroll the list to the chosen time (or to 09:00).
    requestAnimationFrame(() => {
      const target = value ? `${value.slice(0, 2)}:${Number(value.slice(3)) >= 30 ? "30" : "00"}` : "09:00";
      list.current?.querySelector<HTMLElement>(`[data-slot="${target}"]`)?.scrollIntoView({ block: "center" });
    });
  }, [open, value]);

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerCls, !value && "text-muted-foreground")} data-testid={testId} aria-label="Time">
          <Clock className="size-3.5 shrink-0 opacity-70" />
          {value ?? placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1.5" data-testid="time-picker">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && parsed) pick(parsed);
          }}
          placeholder="e.g. 14:30"
          className={cn(
            "mb-1 h-8 w-full rounded-sm border bg-transparent px-2 text-sm outline-none focus:border-ring",
            text && !parsed && "border-destructive focus:border-destructive",
          )}
          aria-label="Type a time"
        />
        <div ref={list} className="max-h-52 overflow-y-auto">
          {SLOTS.map((t) => (
            <button
              key={t}
              type="button"
              data-slot={t}
              onClick={() => pick(t)}
              className={cn("block w-full rounded-sm px-2 py-1 text-left text-[13px] tabular-nums hover:bg-muted", t === value && "bg-primary text-primary-foreground hover:bg-primary")}
            >
              {t}
            </button>
          ))}
        </div>
        {value && (
          <button type="button" onClick={() => pick(null)} className="mt-1 flex w-full items-center gap-1 rounded-sm border-t px-2 pb-0.5 pt-1.5 text-xs text-muted-foreground hover:text-foreground">
            <X className="size-3" /> No time
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
