import { useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventDropArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg, DateClickArg } from "@fullcalendar/interaction";
import { useTodos } from "@/app/queries";
import { useUI } from "@/app/store";
import { updateTodo } from "@/data/todos";
import { toDateStr, todayStr } from "@/lib/dates";
import { addMinutes, format, parseISO } from "date-fns";
import "./calendar.css";

const COLORS: Record<number, string> = { 1: "var(--p1)", 2: "var(--p2)", 3: "var(--p3)", 4: "var(--muted-foreground)" };

/** Month/week calendar of todos by due date. Drag to reschedule, click to open. */
export function CalendarView() {
  const { data: todos = [] } = useTodos();
  const openTodo = useUI((s) => s.openTodo);
  const openQuickAdd = useUI((s) => s.openQuickAdd);
  const calRef = useRef<InstanceType<typeof FullCalendar>>(null);
  const today = todayStr();

  const events = useMemo<EventInput[]>(
    () =>
      todos
        .filter((t) => t.dueDate && !t.deletedAt)
        .map((t) => {
          const done = t.status === "done";
          const overdue = !done && t.dueDate! < today;
          const timed = !!t.dueTime;
          const start = timed ? `${t.dueDate}T${t.dueTime}` : t.dueDate!;
          const end = timed ? format(addMinutes(parseISO(start), t.estimateMin || 30), "yyyy-MM-dd'T'HH:mm") : undefined;
          return {
            id: t.id,
            title: t.title,
            start,
            end,
            allDay: !timed,
            classNames: [done ? "ev-done" : "", overdue ? "ev-overdue" : "", t.noteCount ? "ev-notes" : ""],
            backgroundColor: "transparent",
            borderColor: COLORS[t.priority],
            textColor: "var(--foreground)",
            extendedProps: { priority: t.priority },
          };
        }),
    [todos, today],
  );

  const onDrop = async (arg: EventDropArg | EventResizeDoneArg) => {
    const { event } = arg;
    if (!event.start) return;
    const dueDate = toDateStr(event.start);
    const patch: Parameters<typeof updateTodo>[1] = { dueDate };
    if (event.allDay) patch.dueTime = null;
    else {
      patch.dueTime = format(event.start, "HH:mm");
      if (event.end) patch.estimateMin = Math.max(15, Math.round((event.end.getTime() - event.start.getTime()) / 60000));
    }
    await updateTodo(event.id, patch);
  };

  return (
    <div className="flex h-full flex-col px-6 pb-4 pt-5" data-testid="calendar">
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "title", center: "", right: "today prev,next dayGridMonth,timeGridWeek" }}
        buttonText={{ today: "Today", month: "Month", week: "Week" }}
        firstDay={1}
        height="100%"
        events={events}
        editable
        eventStartEditable
        eventDurationEditable
        dayMaxEvents={4}
        nowIndicator
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        scrollTime="08:00:00"
        allDayText="All day"
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        eventClick={(info) => openTodo(info.event.id)}
        eventDrop={onDrop}
        eventResize={onDrop}
        dateClick={(info: DateClickArg) => openQuickAdd({ dueDate: toDateStr(info.date) })}
      />
    </div>
  );
}
