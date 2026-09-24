import { useState } from "react";
import { Command } from "cmdk";
import { FileText, Plus, Circle, CheckCircle2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotes, useTodos } from "@/app/queries";
import { dirname } from "@/lib/paths";

const listCls = "max-h-72 overflow-y-auto p-1";
const itemCls =
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const inputCls = "h-9 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground";

/** Search-as-you-type note picker. */
export function NotePicker({ trigger, exclude = [], onPick }: { trigger: React.ReactNode; exclude?: string[]; onPick: (noteId: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: notes = [] } = useNotes();
  const options = notes.filter((n) => !exclude.includes(n.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command>
          <Command.Input autoFocus placeholder="Search notes…" className={inputCls} />
          <Command.List className={listCls}>
            <Command.Empty className="px-2 py-3 text-center text-xs text-muted-foreground">No notes found</Command.Empty>
            {options.map((n) => (
              <Command.Item
                key={n.id}
                value={`${n.title} ${n.path} ${n.id}`}
                onSelect={() => {
                  onPick(n.id);
                  setOpen(false);
                }}
                className={itemCls}
              >
                <FileText />
                <span className="truncate">{n.title}</span>
                <span className="ml-auto truncate text-xs text-muted-foreground">{dirname(n.path)}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Pick an existing todo, or create a new one from the typed text. */
export function TodoPicker({
  trigger,
  exclude = [],
  onPick,
  onCreate,
}: {
  trigger: React.ReactNode;
  exclude?: string[];
  onPick: (todoId: string) => void;
  onCreate: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: todos = [] } = useTodos();
  const options = todos.filter((t) => !exclude.includes(t.id) && !t.parentId);
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setQ(""))}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command>
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Search todos or type a new one…" className={inputCls} />
          <Command.List className={listCls}>
            {q.trim() && (
              <Command.Item
                value={`__create__ ${q}`}
                onSelect={() => {
                  onCreate(q.trim());
                  setOpen(false);
                }}
                className={itemCls}
              >
                <Plus /> Create todo “{q.trim()}”
              </Command.Item>
            )}
            {options.map((t) => (
              <Command.Item
                key={t.id}
                value={`${t.title} ${t.id}`}
                onSelect={() => {
                  onPick(t.id);
                  setOpen(false);
                }}
                className={itemCls}
              >
                {t.status === "done" ? <CheckCircle2 /> : <Circle />}
                <span className="truncate">{t.title}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
