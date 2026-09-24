import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { format } from "date-fns";
import { useVersions } from "@/app/queries";
import { restoreVersion } from "@/data/history";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as notes from "@/data/notes";
import { useQuery } from "@tanstack/react-query";

export function HistoryDialog({
  noteId,
  onClose,
  onRestored,
  beforeRestore,
}: {
  noteId: string;
  onClose: () => void;
  onRestored: (body: string) => void;
  beforeRestore: () => Promise<void>;
}) {
  const { data: versions = [] } = useVersions(noteId);
  const { data: current } = useQuery({ queryKey: ["noteBody", noteId], queryFn: () => notes.readNote(noteId) });
  const [selected, setSelected] = useState<string | null>(null);
  const version = versions.find((v) => v.id === selected) ?? versions[0];

  const parts = useMemo(() => (version && current ? diffLines(version.content, current.body) : []), [version, current]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Version history" className="top-[8%] w-[900px]">
        {versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No earlier versions yet. Snapshots are taken automatically while you edit (at most every 10 minutes).
          </p>
        ) : (
          <div className="flex h-[60vh] gap-3">
            <ul className="w-52 shrink-0 space-y-px overflow-y-auto border-r pr-2">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => setSelected(v.id)}
                    className={cn("w-full rounded px-2 py-1.5 text-left text-[13px]", v.id === version?.id ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
                  >
                    {format(new Date(v.createdAt), "EEE d MMM, HH:mm")}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="mb-2 text-xs text-muted-foreground">
                <span className="rounded-sm bg-destructive/15 px-1 text-destructive">red</span> only in this version ·{" "}
                <span className="rounded-sm bg-success/15 px-1 text-success">green</span> added since
              </p>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {parts.map((p, i) => (
                  <span key={i} className={cn(p.removed && "bg-destructive/15 text-destructive", p.added && "bg-success/15 text-success")}>
                    {p.value}
                  </span>
                ))}
              </pre>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button
                  onClick={async () => {
                    if (!version) return;
                    await beforeRestore();
                    const body = await restoreVersion(version);
                    onRestored(body);
                    onClose();
                  }}
                >
                  Restore this version
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
