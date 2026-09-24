import { useEffect, useState } from "react";
import {
  X,
  Trash2,
  Calendar,
  Clock,
  Flag,
  CircleDot,
  Folder,
  Timer,
  FileText,
  Link2,
  Unlink,
  Plus,
  ArrowLeft,
  ListTree,
  ArchiveRestore,
  PlayCircle,
} from "lucide-react";
import { useUI } from "@/app/store";
import { useFolders, useNotesForTodo, useSubtasks, useTodo } from "@/app/queries";
import * as todos from "@/data/todos";
import type { Priority, Todo, TodoStatus } from "@/data/types";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/data/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { NotePicker } from "@/components/Pickers";
import { RecurrencePicker } from "./RecurrencePicker";
import { PRIORITY_COLOR } from "./TodoRow";
import { addDaysStr, formatEstimate, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

export function TodoDetail() {
  const id = useUI((s) => s.selectedTodoId);
  const openTodo = useUI((s) => s.openTodo);
  const { data: todo, isFetched } = useTodo(id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]")) openTodo(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTodo]);

  useEffect(() => {
    if (isFetched && id && !todo) openTodo(null); // deleted elsewhere
  }, [isFetched, id, todo, openTodo]);

  if (!id || !todo) return null;
  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l bg-background" data-testid="todo-detail">
      <DetailBody key={todo.id} todo={todo} />
    </aside>
  );
}

function DetailBody({ todo }: { todo: Todo }) {
  const openTodo = useUI((s) => s.openTodo);
  const setView = useUI((s) => s.setView);
  const { data: folders = [] } = useFolders();
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description);
  useEffect(() => setTitle(todo.title), [todo.title]);
  useEffect(() => setDescription(todo.description), [todo.description]);

  const update = (patch: todos.TodoPatch) => todos.updateTodo(todo.id, patch);
  const done = todo.status === "done";

  return (
    <>
      <div className="flex h-11 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {todo.parentId ? (
            <button className="flex items-center gap-1 hover:text-foreground" onClick={() => openTodo(todo.parentId)}>
              <ArrowLeft className="size-3.5" /> Parent todo
            </button>
          ) : (
            <span>Todo</span>
          )}
        </div>
        <div className="flex items-center">
          {todo.archivedAt && (
            <Tooltip content="Restore from archive">
              <Button size="icon" variant="ghost" onClick={() => todos.unarchive(todo.id)} aria-label="Unarchive">
                <ArchiveRestore />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Delete">
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                await todos.deleteTodo(todo.id);
                openTodo(null);
              }}
              aria-label="Delete todo"
            >
              <Trash2 />
            </Button>
          </Tooltip>
          <Button size="icon" variant="ghost" onClick={() => openTodo(null)} aria-label="Close">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
        <div className="flex items-start gap-3">
          <Checkbox round checked={done} color={PRIORITY_COLOR[todo.priority]} onChange={(v) => todos.setDone(todo.id, v)} className="mt-1.5" label="Complete" />
          <textarea
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== todo.title && update({ title: title.trim() })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            className={cn("field-sizing-content w-full resize-none bg-transparent text-lg font-semibold leading-snug outline-none", done && "text-muted-foreground line-through")}
            aria-label="Title"
            data-testid="detail-title"
          />
        </div>

        <div className="mt-4 grid grid-cols-[110px_1fr] items-center gap-y-0.5 text-[13px]">
          <Prop icon={CircleDot} label="Status">
            <Select<TodoStatus>
              value={todo.status}
              onChange={(v) => update({ status: v })}
              options={(Object.keys(STATUS_LABELS) as TodoStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              className="h-7 border-transparent hover:border-input"
              aria-label="Status"
            />
          </Prop>
          <Prop icon={Flag} label="Priority">
            <Select<string>
              value={String(todo.priority)}
              onChange={(v) => update({ priority: Number(v) as Priority })}
              options={([1, 2, 3, 4] as Priority[]).map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] }))}
              className="h-7 border-transparent hover:border-input"
              aria-label="Priority"
            />
          </Prop>
          <Prop icon={Calendar} label="Due">
            <DateField value={todo.dueDate} onChange={(v) => update({ dueDate: v })} testId="due-date" />
            {todo.dueDate && (
              <input
                type="time"
                value={todo.dueTime ?? ""}
                onChange={(e) => update({ dueTime: e.target.value || null })}
                className="ml-1 h-7 rounded border border-transparent bg-transparent px-1 text-[13px] hover:border-input"
                aria-label="Due time"
              />
            )}
          </Prop>
          <Prop icon={PlayCircle} label="Start">
            <DateField value={todo.startDate} onChange={(v) => update({ startDate: v })} testId="start-date" />
          </Prop>
          <Prop icon={Clock} label="Repeat">
            <RecurrencePicker
              rrule={todo.rrule}
              fromCompletion={todo.recurFromCompletion}
              anchor={todo.dueDate}
              onChange={(rrule, fromCompletion) =>
                update({ rrule, recurFromCompletion: fromCompletion, ...(rrule && !todo.dueDate ? { dueDate: todayStr() } : {}) })
              }
            />
          </Prop>
          <Prop icon={Timer} label="Estimate">
            <Select<string>
              value={String(todo.estimateMin ?? "")}
              onChange={(v) => update({ estimateMin: v ? Number(v) : null })}
              options={[
                { value: "", label: "None" },
                ...[15, 30, 45, 60, 90, 120, 180, 240, 480].map((m) => ({ value: String(m), label: formatEstimate(m) })),
                ...(todo.estimateMin && ![15, 30, 45, 60, 90, 120, 180, 240, 480].includes(todo.estimateMin)
                  ? [{ value: String(todo.estimateMin), label: formatEstimate(todo.estimateMin) }]
                  : []),
              ]}
              className="h-7 border-transparent hover:border-input"
              aria-label="Estimate"
            />
          </Prop>
          <Prop icon={Folder} label="Folder">
            <Select<string>
              value={todo.folderId ?? ""}
              onChange={(v) => update({ folderId: v || null })}
              options={[{ value: "", label: "Inbox (no folder)" }, ...folders.map((f) => ({ value: f.id, label: f.path }))]}
              className="h-7 max-w-full border-transparent hover:border-input"
              aria-label="Folder"
            />
          </Prop>
        </div>

        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== todo.description && update({ description })}
          placeholder="Add a description…"
          className="field-sizing-content mt-4 min-h-20 resize-none border-transparent bg-muted/40 px-3 py-2 hover:bg-muted/70 focus-visible:bg-transparent"
          aria-label="Description"
        />

        {!todo.parentId && <Subtasks todo={todo} />}
        <LinkedNotes todo={todo} onOpen={(id) => setView({ kind: "note", id })} />

        <p className="mt-8 text-[11px] text-muted-foreground">
          Created {format(new Date(todo.createdAt), "d MMM yyyy HH:mm")}
          {todo.completedAt && ` · Completed ${format(new Date(todo.completedAt), "d MMM yyyy HH:mm")}`}
        </p>
      </div>
    </>
  );
}

function Prop({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flex h-8 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="flex min-w-0 items-center">{children}</div>
    </>
  );
}

/** Native date input with quick picks and a clear button. */
export function DateField({ value, onChange, testId }: { value: string | null; onChange: (v: string | null) => void; testId?: string }) {
  const today = todayStr();
  return (
    <div className="group flex items-center gap-1">
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn("h-7 rounded border border-transparent bg-transparent px-1 text-[13px] hover:border-input", !value && "text-muted-foreground")}
        data-testid={testId}
      />
      {!value && (
        <span className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <QuickDate onClick={() => onChange(today)}>Today</QuickDate>
          <QuickDate onClick={() => onChange(addDaysStr(today, 1))}>Tomorrow</QuickDate>
        </span>
      )}
      {value && (
        <button onClick={() => onChange(null)} className="rounded-sm p-0.5 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100" aria-label="Clear date">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function QuickDate({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}

function SubHeader({ icon: Icon, title, extra }: { icon: React.ComponentType<{ className?: string }>; title: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-6 flex items-center gap-2 text-xs font-semibold text-foreground/80">
      <Icon className="size-3.5 text-muted-foreground" /> {title}
      <span className="ml-auto font-normal">{extra}</span>
    </div>
  );
}

function AddLine({ placeholder, onAdd, testId }: { placeholder: string; onAdd: (text: string) => Promise<unknown>; testId?: string }) {
  const [text, setText] = useState("");
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <Plus className="size-3.5 text-muted-foreground" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Enter" && text.trim()) {
            await onAdd(text.trim());
            setText("");
          }
        }}
        placeholder={placeholder}
        className="h-6 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        data-testid={testId}
      />
    </div>
  );
}

function Subtasks({ todo }: { todo: Todo }) {
  const { data: subtasks = [] } = useSubtasks(todo.id);
  const openTodo = useUI((s) => s.openTodo);
  return (
    <div>
      <SubHeader icon={ListTree} title="Subtasks" extra={subtasks.length ? `${subtasks.filter((s) => s.status === "done").length}/${subtasks.length}` : null} />
      {subtasks.map((s) => (
        <div key={s.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/70">
          <Checkbox round checked={s.status === "done"} color={PRIORITY_COLOR[s.priority]} onChange={(v) => todos.setDone(s.id, v)} />
          <button className={cn("flex-1 truncate text-left text-[13px]", s.status === "done" && "text-muted-foreground line-through")} onClick={() => openTodo(s.id)}>
            {s.title}
          </button>
          {s.dueDate && <span className="text-xs text-muted-foreground">{s.dueDate}</span>}
        </div>
      ))}
      <AddLine placeholder="Add subtask" onAdd={(t) => todos.createTodo({ title: t, parentId: todo.id, folderId: todo.folderId })} testId="add-subtask" />
    </div>
  );
}

function LinkedNotes({ todo, onOpen }: { todo: Todo; onOpen: (id: string) => void }) {
  const { data: linked = [] } = useNotesForTodo(todo.id);
  return (
    <div>
      <SubHeader
        icon={FileText}
        title="Linked notes"
        extra={
          <NotePicker
            exclude={linked.map((n) => n.id)}
            onPick={(noteId) => todos.linkNote(todo.id, noteId)}
            trigger={
              <button className="flex items-center gap-1 text-muted-foreground hover:text-primary" data-testid="link-note">
                <Link2 className="size-3.5" /> Link note
              </button>
            }
          />
        }
      />
      {linked.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No notes linked yet.</p>}
      {linked.map((n) => (
        <div key={n.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/70">
          <FileText className="size-3.5 text-muted-foreground" />
          <button className="flex-1 truncate text-left text-[13px] hover:underline" onClick={() => onOpen(n.id)}>
            {n.title}
            {todo.sourceNoteId === n.id && <span className="ml-2 text-[11px] text-muted-foreground">(created from this note)</span>}
          </button>
          <Tooltip content="Unlink">
            <button onClick={() => todos.unlinkNote(todo.id, n.id)} className="p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100" aria-label="Unlink note">
              <Unlink className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
