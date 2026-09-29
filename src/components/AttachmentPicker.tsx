import { useMemo, useState } from "react";
import { create } from "zustand";
import { Film, Image, Music, Paperclip, Upload } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { basename } from "@/lib/paths";
import { fileKind } from "@/lib/files";
import { cn } from "@/lib/utils";

export type PickKind = "document" | "image" | "video" | "audio";
export type PickResult = { type: "existing"; path: string } | { type: "upload" } | null;

const TITLES: Record<PickKind, string> = {
  document: "Insert a file",
  image: "Insert an image",
  video: "Insert a video",
  audio: "Insert audio",
};
const ICONS = { image: Image, video: Film, audio: Music, other: Paperclip };

interface State {
  request: { kind: PickKind; files: string[]; resolve: (r: PickResult) => void } | null;
}
const usePicker = create<State>(() => ({ request: null }));

/** Choose one of `files` (vault paths already in the folder), or "upload a new one". */
export function pickAttachment(kind: PickKind, files: string[]): Promise<PickResult> {
  return new Promise((resolve) => {
    usePicker.getState().request?.resolve(null);
    usePicker.setState({ request: { kind, files, resolve } });
  });
}

/** Mount once per window. */
export function AttachmentPickerHost() {
  const request = usePicker((s) => s.request);
  const close = (r: PickResult) => {
    request?.resolve(r);
    usePicker.setState({ request: null });
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(null)}>
      {request && (
        <DialogContent title={TITLES[request.kind]} className="w-[440px]" data-testid="attachment-picker">
          <PickerBody files={request.files} onPick={(path) => close({ type: "existing", path })} onUpload={() => close({ type: "upload" })} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PickerBody({ files, onPick, onUpload }: { files: string[]; onPick: (path: string) => void; onUpload: () => void }) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const shown = useMemo(() => files.filter((f) => basename(f).toLowerCase().includes(q.trim().toLowerCase())), [files, q]);

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">Files already in this folder</p>
      {files.length > 6 && (
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, shown.length - 1));
            else if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter" && shown[index]) onPick(shown[index]);
            else return;
            e.preventDefault();
          }}
          placeholder="Find a file…"
          className="mb-1 h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm outline-none focus:border-ring"
        />
      )}
      <div className="max-h-72 overflow-y-auto">
        {shown.map((path, i) => {
          const Icon = ICONS[fileKind(path)];
          return (
            <button
              key={path}
              onClick={() => onPick(path)}
              onMouseEnter={() => setIndex(i)}
              className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]", i === index ? "bg-muted" : "hover:bg-muted")}
              data-testid="picker-file"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{basename(path)}</span>
            </button>
          );
        })}
        {!shown.length && <p className="px-2 py-3 text-xs text-muted-foreground">No matching files.</p>}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onUpload} data-testid="picker-upload" autoFocus={files.length <= 6}>
          <Upload /> Upload file…
        </Button>
      </div>
    </div>
  );
}
