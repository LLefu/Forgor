import { RRule, Frequency } from "rrule";
import { toDateStr } from "./dates";

/**
 * Recurrence is stored as an RRULE string without DTSTART, e.g.
 * "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE". The anchor date is the todo's due
 * date (or the completion date when "repeat from completion" is on).
 */

function toUtcDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Next occurrence strictly after `anchor` (YYYY-MM-DD). */
export function nextOccurrence(rrule: string, anchor: string): string | null {
  const opts = RRule.parseString(rrule);
  const rule = new RRule({ ...opts, dtstart: toUtcDay(anchor) });
  const next = rule.after(toUtcDay(anchor), false);
  return next ? fromUtcDay(next) : null;
}

/** First N occurrences starting at (and including) `anchor`. Used for the calendar and previews. */
export function occurrences(rrule: string, anchor: string, until: string, limit = 60): string[] {
  const opts = RRule.parseString(rrule);
  const rule = new RRule({ ...opts, dtstart: toUtcDay(anchor), until: toUtcDay(until) });
  return rule.all((_, i) => i < limit).map(fromUtcDay);
}

export function describeRRule(rrule: string | null): string {
  if (!rrule) return "Does not repeat";
  try {
    return capitalize(RRule.fromString(rrule).toText());
  } catch {
    return rrule;
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type RecurrencePreset = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

const WEEKDAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

/** Build an RRULE string for a preset, anchored on the given date. */
export function presetToRRule(preset: RecurrencePreset, anchor: string = toDateStr(new Date())): string | null {
  const d = toUtcDay(anchor);
  const weekday = WEEKDAYS[(d.getUTCDay() + 6) % 7];
  let rule: RRule;
  switch (preset) {
    case "none":
    case "custom":
      return null;
    case "daily":
      rule = new RRule({ freq: Frequency.DAILY });
      break;
    case "weekdays":
      rule = new RRule({ freq: Frequency.WEEKLY, byweekday: WEEKDAYS.slice(0, 5) });
      break;
    case "weekly":
      rule = new RRule({ freq: Frequency.WEEKLY, byweekday: [weekday] });
      break;
    case "biweekly":
      rule = new RRule({ freq: Frequency.WEEKLY, interval: 2, byweekday: [weekday] });
      break;
    case "monthly":
      rule = new RRule({ freq: Frequency.MONTHLY, bymonthday: [d.getUTCDate()] });
      break;
    case "yearly":
      rule = new RRule({ freq: Frequency.YEARLY, bymonth: [d.getUTCMonth() + 1], bymonthday: [d.getUTCDate()] });
      break;
  }
  return rule.toString().replace(/^RRULE:/, "");
}

export type CustomUnit = "day" | "week" | "month" | "year";

export function customRRule(interval: number, unit: CustomUnit, weekdays: number[] = []): string {
  const freq = { day: Frequency.DAILY, week: Frequency.WEEKLY, month: Frequency.MONTHLY, year: Frequency.YEARLY }[unit];
  const rule = new RRule({
    freq,
    interval: Math.max(1, Math.floor(interval)),
    byweekday: unit === "week" && weekdays.length ? weekdays.map((i) => WEEKDAYS[i]) : undefined,
  });
  return rule.toString().replace(/^RRULE:/, "");
}
