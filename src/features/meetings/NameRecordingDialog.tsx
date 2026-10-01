import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderSelect } from "@/features/folder/folderColors";
import { useMeetingsStore } from "@/app/meetings";
import { getMeeting, nameAndAssign } from "@/data/meetings";
import { showError } from "@/components/Toasts";

/**
 * Shown right after a recording stops: a name (a simple default is filled in)
 * and a folder (unassigned by default). Closing it keeps the defaults; the
 * transcript is written into the note in the background either way.
 */
export function NameRecordingDialogHost() {
  const naming = useMeetingsStore((s) => s.naming);
  const close = useMeetingsStore((s) => s.closeNaming);
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (!naming) return;
    setFolderId(null);
    void getMeeting(naming).then((m) => setTitle(m?.note?.title ?? ""));
  }, [naming]);

  const save = async () => {
    if (!naming) return;
    try {
      await nameAndAssign(naming, title, folderId);
      close();
    } catch (e) {
      showError(e, "Could not save the recording");
    }
  };

  return (
    <Dialog open={!!naming} onOpenChange={(open) => !open && close()}>
      <DialogContent title="Save recording" className="w-[440px]" data-testid="name-recording">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.target.select()} data-testid="recording-name" />
          </label>
          <div className="space-y-1">
            <span className="block text-xs text-muted-foreground">Folder</span>
            <FolderSelect value={folderId} onChange={setFolderId} noneLabel="Unassigned (Meetings only)" className="w-full border-input" testId="recording-folder" />
          </div>
          <p className="text-xs text-muted-foreground">The transcript and summary are being made on this computer and appear in the note in a minute or two.</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close}>
              Later
            </Button>
            <Button type="submit" data-testid="save-recording">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
