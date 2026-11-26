import { useEffect, useRef, type RefObject } from "react";
import { onDataChange } from "@/data/context";
import * as notes from "@/data/notes";
import { saveNote } from "@/data/noteSave";
import type { NoteEditorHandle } from "./NoteEditor";

const SAVE_DELAY = 600;

/**
 * Compare note bodies ignoring leading blank lines and trailing whitespace: the
 * file format normalises those, so a strict comparison mistook our own save for
 * an external edit and reloaded the editor mid-typing (cursor jumped to the top).
 */
export function sameContent(a: string, b: string) {
  const norm = (s: string) => s.replace(/^(\s*\n)+/, "").trimEnd();
  return norm(a) === norm(b);
}

/**
 * Saving a note from an editor (the note tab, a plugin's embedded editor):
 * edits are saved after a short pause and on unmount; a change on disk is
 * loaded into the editor while nothing is waiting to be saved.
 */
export function useNoteSaving(id: string, initialBody: string, editor: RefObject<NoteEditorHandle | null>) {
  const lastSaved = useRef(initialBody);
  const pending = useRef<string | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = async () => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const md = pending.current;
    pending.current = null;
    if (md === null || sameContent(md, lastSaved.current)) return;
    saving.current = saveNote(id, md)
      .then((final) => {
        lastSaved.current = final;
      })
      .finally(() => {
        saving.current = null;
      });
    await saving.current;
  };

  const onChange = (md: string) => {
    pending.current = md;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  };

  useEffect(() => {
    const off = onDataChange(async (topics) => {
      if (!topics.includes("notes") || pending.current !== null || saving.current) return;
      const n = await notes.readNote(id);
      if (!n || pending.current !== null || saving.current) return;
      if (!sameContent(n.body, lastSaved.current)) {
        lastSaved.current = n.body;
        editor.current?.setMarkdown(n.body);
      }
    });
    return () => {
      off();
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** A version was restored outside the editor: show it, it's what's on disk now. */
  const restored = (body: string) => {
    lastSaved.current = body;
    editor.current?.setMarkdown(body);
  };

  return { onChange, flush, restored };
}
