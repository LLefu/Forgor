import { useEffect, useState } from "react";
import { useUI } from "@/app/store";
import { createTodo } from "@/data/todos";
import type { Priority } from "@/data/types";
import { PRIORITY_LABELS } from "@/data/types";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePicker, TimePicker } from "@/components/DateTimePickers";
import { FolderSelect } from "@/features/folder/folderColors";
import { addDaysStr, todayStr } from "@/lib/dates";

export function QuickAddDialog() {
  const { open, defaults } = useUI((s) => s.quickAdd);
  const close = useUI((s) => s.closeQuickAdd);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      {open && (
        <DialogContent title="New todo">
          <QuickAddForm
            defaults={defaults}
            onDone={close}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Also used by the global-hotkey popup window. */
export function QuickAddForm({
  defaults,
  onDone,
  autoFocus = true,
}: {
  defaults: { folderId?: string | null; dueDate?: string | null };
  onDone: (id?: string) => void;
  autoFocus?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>(defaults.dueDate ?? "");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<Priority>(4);
  const [folderId, setFolderId] = useState(defaults.folderId ?? "");
  const today = todayStr();

  useEffect(() => setFolderId(defaults.folderId ?? ""), [defaults.folderId]);

  const submit = async () => {
    if (!title.trim()) return;
    const t = await createTodo({
      title,
      description,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      priority,
      folderId: folderId || null,
    });
    onDone(t.id);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-3"
      data-testid="quick-add"
    >
      <Input autoFocus={autoFocus} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" className="h-9 text-[15px]" aria-label="Title" />
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="resize-none" />
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker value={dueDate || null} onChange={(v) => setDueDate(v ?? "")} className="h-8 border-input" aria-label="Due date" testId="quick-due" />
        {dueDate && <TimePicker value={dueTime || null} onChange={(v) => setDueTime(v ?? "")} />}
        <Button type="button" size="sm" variant={!dueDate ? "secondary" : "ghost"} onClick={() => setDueDate("")}>
          No date
        </Button>
        <Button type="button" size="sm" variant={dueDate === today ? "secondary" : "ghost"} onClick={() => setDueDate(today)}>
          Today
        </Button>
        <Button type="button" size="sm" variant={dueDate === addDaysStr(today, 1) ? "secondary" : "ghost"} onClick={() => setDueDate(addDaysStr(today, 1))}>
          Tomorrow
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Select<string>
          value={String(priority)}
          onChange={(v) => setPriority(Number(v) as Priority)}
          options={([1, 2, 3, 4] as Priority[]).map((p) => ({ value: String(p), label: PRIORITY_LABELS[p] }))}
          aria-label="Priority"
        />
        <FolderSelect value={folderId || null} onChange={(id) => setFolderId(id ?? "")} className="h-8 min-w-0 flex-1 border-input" testId="quick-folder" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" disabled={!title.trim()}>
          Add todo
        </Button>
      </div>
    </form>
  );
}
