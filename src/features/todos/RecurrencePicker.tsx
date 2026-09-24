import { useState } from "react";
import { Repeat } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { customRRule, describeRRule, presetToRRule, type CustomUnit, type RecurrencePreset } from "@/lib/recurrence";
import { format, parseISO } from "date-fns";
import { todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function RecurrencePicker({
  rrule,
  fromCompletion,
  anchor,
  onChange,
}: {
  rrule: string | null;
  fromCompletion: boolean;
  /** Date the rule is anchored on (due date, or today). */
  anchor: string | null;
  onChange: (rrule: string | null, fromCompletion: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [interval, setInterval] = useState(1);
  const [unit, setUnit] = useState<CustomUnit>("week");
  const [days, setDays] = useState<number[]>([]);
  const base = anchor ?? todayStr();
  const d = parseISO(base);

  const presets: { value: RecurrencePreset; label: string }[] = [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Every day" },
    { value: "weekdays", label: "Every weekday (Mon–Fri)" },
    { value: "weekly", label: `Every week on ${format(d, "EEEE")}` },
    { value: "biweekly", label: `Every 2 weeks on ${format(d, "EEEE")}` },
    { value: "monthly", label: `Every month on the ${format(d, "do")}` },
    { value: "yearly", label: `Every year on ${format(d, "d MMMM")}` },
  ];

  const pick = (p: RecurrencePreset) => {
    onChange(presetToRRule(p, base), fromCompletion);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setCustom(false))}>
      <PopoverTrigger asChild>
        <button className={cn("flex h-7 items-center gap-1.5 rounded px-2 text-left text-[13px] hover:bg-muted", !rrule && "text-muted-foreground")}>
          <Repeat className="size-3.5" />
          <span className="truncate">{describeRRule(rrule)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1">
        {!custom ? (
          <>
            {presets.map((p) => (
              <button key={p.value} className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-muted" onClick={() => pick(p.value)}>
                {p.label}
              </button>
            ))}
            <button className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-muted" onClick={() => setCustom(true)}>
              Custom…
            </button>
            <label className="mt-1 flex items-center gap-2 border-t px-2 pb-1 pt-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={fromCompletion} onChange={(e) => onChange(rrule, e.target.checked)} />
              Repeat from completion date instead of due date
            </label>
          </>
        ) : (
          <div className="space-y-3 p-2">
            <div className="flex items-center gap-2">
              <span>Every</span>
              <Input type="number" min={1} value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="w-16" />
              <Select
                value={unit}
                onChange={setUnit}
                options={[
                  { value: "day", label: interval > 1 ? "days" : "day" },
                  { value: "week", label: interval > 1 ? "weeks" : "week" },
                  { value: "month", label: interval > 1 ? "months" : "month" },
                  { value: "year", label: interval > 1 ? "years" : "year" },
                ]}
              />
            </div>
            {unit === "week" && (
              <div className="flex gap-1">
                {DAYS.map((label, i) => (
                  <button
                    key={label}
                    onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
                    className={cn("h-7 w-8 rounded text-xs", days.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCustom(false)}>
                Back
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onChange(customRRule(interval, unit, days), fromCompletion);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
