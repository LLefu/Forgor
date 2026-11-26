import { useEffect, useRef, useState } from "react";
import { useUI } from "@/app/store";
import { useNoteMeta } from "@/app/queries";
import * as notes from "@/data/notes";
import { snapshotNow } from "@/data/noteSave";
import { dirname, isMeetingsPath } from "@/lib/paths";
import { openVaultFile } from "@/platform/os";
import { useEditorWriter } from "@/plugins/registry";
import { useEditorExtensions } from "@/plugins/editor";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";
import { useNoteSaving } from "./useNoteSaving";

/**
 * A note's editor without the note page around it (no title, toolbar or
 * footer), for plugins (`api.ui.NoteEditor`): a folder page shows its folder
 * note this way. Same editor and saving as a note tab: todos, "@" links,
 * writing tools, plugins' editor items.
 */
export function EmbeddedNote({ noteId, className }: { noteId: string; className?: string }) {
  const [loaded, setLoaded] = useState<{ id: string; body: string } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setMissing(false);
    notes.readNote(noteId).then((n) => {
      if (cancelled) return;
      if (!n) setMissing(true);
      else setLoaded({ id: noteId, body: n.body });
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (missing) return <p className="text-sm text-muted-foreground">This note no longer exists.</p>;
  if (!loaded || loaded.id !== noteId) return null;
  return <Loaded key={noteId} id={noteId} initialBody={loaded.body} className={className} />;
}

function Loaded({ id, initialBody, className }: { id: string; initialBody: string; className?: string }) {
  const { data: meta } = useNoteMeta(id);
  const editor = useRef<NoteEditorHandle>(null);
  const { onChange, flush } = useNoteSaving(id, initialBody, editor);
  const writer = useEditorWriter();
  const extensions = useEditorExtensions();
  if (!meta) return null;
  return (
    <div className={className} data-testid="embedded-note">
      <NoteEditor
        ref={editor}
        noteId={id}
        notePath={meta.path}
        initial={initialBody}
        onChange={onChange}
        onOpenMention={(kind, target) => {
          if (kind === "todo") useUI.getState().openTodo(target);
          else if (kind === "folder") useUI.getState().openFolder(target);
          else useUI.getState().setView({ kind: "note", id: target });
        }}
        onCreateNote={(title) => notes.createNote(isMeetingsPath(meta.path) ? "" : dirname(meta.path), title)}
        onOpenFile={(path) => void openVaultFile(path)}
        writer={writer}
        extensions={extensions}
        onBeforeAI={async () => {
          await flush();
          await snapshotNow(id);
        }}
      />
    </div>
  );
}
