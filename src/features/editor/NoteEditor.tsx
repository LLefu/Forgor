import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { replaceAll, insert } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import "@milkdown/crepe/theme/common/style.css";
import "./editor.css";
import { useUI } from "@/app/store";
import { useNotes } from "@/app/queries";
import { ctx } from "@/data/context";
import { saveAttachment } from "@/data/notes";
import { resolveWikiTarget } from "@/lib/wikilinks";
import { dirname, resolvePath } from "@/lib/paths";
import {
  assignMarkersInView,
  completeWikiLink,
  filePastePlugin,
  inlineTodoDecorations,
  wikiLinkPlugin,
  wikiSuggestPlugin,
  type SuggestState,
} from "./plugins";
import { WikiSuggest, type WikiSuggestHandle } from "./WikiSuggest";
import { codeTheme } from "./codeTheme";
import { cleanMarkdown } from "@/lib/markdown";

export interface NoteEditorHandle {
  /** Replace content (external change). */
  setMarkdown: (md: string) => void;
  getMarkdown: () => string;
  focus: () => void;
}

interface Props {
  noteId: string;
  notePath: string;
  initial: string;
  onChange: (markdown: string) => void;
  onOpenWikiLink: (target: string) => void;
}

const isExternal = (url: string) => /^(https?:|data:|blob:|asset:|http:\/\/asset\.localhost)/.test(url);

export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor({ noteId, notePath, initial, onChange, onOpenWikiLink }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const suggestRef = useRef<WikiSuggestHandle>(null);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const { data: notes = [] } = useNotes();

  // Latest values for use inside long-lived editor callbacks.
  const live = useRef({ notes, notePath, onChange, onOpenWikiLink });
  live.current = { notes, notePath, onChange, onOpenWikiLink };

  useImperativeHandle(ref, () => ({
    setMarkdown: (md) => crepeRef.current?.editor.action(replaceAll(md, true)),
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? "",
    focus: () => crepeRef.current?.editor.action((c) => c.get(editorViewCtx).focus()),
  }));

  useEffect(() => {
    if (!root.current) return;
    let disposed = false;
    const toDisplayUrl = (url: string) => {
      if (!url || isExternal(url)) return url;
      return ctx().vault.fileUrl(resolvePath(dirname(live.current.notePath), url));
    };

    const crepe = new Crepe({
      root: root.current,
      defaultValue: initial,
      features: { [Crepe.Feature.AI]: false, [Crepe.Feature.Latex]: false, [Crepe.Feature.TopBar]: false },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: "Start writing… type / for blocks, [[ to link a note, - [ ] for a todo", mode: "doc" },
        [Crepe.Feature.CodeMirror]: { theme: codeTheme },
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file) => (await saveAttachment(noteId, file.name, new Uint8Array(await file.arrayBuffer()))).rel,
          proxyDomURL: toDisplayUrl,
        },
      },
    });

    crepe.editor
      .use(inlineTodoDecorations((id) => useUI.getState().openTodo(id)))
      .use(
        wikiLinkPlugin({
          exists: (t) => !!resolveWikiTarget(t, live.current.notes),
          onOpen: (t) => live.current.onOpenWikiLink(t),
        }),
      )
      .use(
        wikiSuggestPlugin({
          onChange: (s) => setSuggest(s.active ? s : null),
          onKey: (key) => suggestRef.current?.onKey(key) ?? false,
        }),
      )
      .use(
        filePastePlugin(async (files, view, pos) => {
          for (const file of files) {
            const { rel } = await saveAttachment(noteId, file.name || "pasted.png", new Uint8Array(await file.arrayBuffer()));
            const md = file.type.startsWith("image/") ? `![${file.name}](${rel})` : `[${file.name}](${rel})`;
            if (pos !== null) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
            crepe.editor.action(insert(md + "\n"));
          }
        }),
      );

    let markerTimer: ReturnType<typeof setTimeout> | undefined;
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown, prev) => {
        if (markdown === prev) return;
        live.current.onChange(cleanMarkdown(markdown));
        // After a pause, give new "- [ ]" items a todo marker (creates the todo on save).
        clearTimeout(markerTimer);
        markerTimer = setTimeout(() => {
          crepe.editor.action((c) => assignMarkersInView(c.get(editorViewCtx)));
        }, 900);
      });
    });

    void crepe.create().then(() => {
      if (disposed) void crepe.destroy();
      else crepeRef.current = crepe;
    });

    return () => {
      disposed = true;
      clearTimeout(markerTimer);
      if (crepeRef.current === crepe) {
        crepeRef.current = null;
        void crepe.destroy();
      }
    };
    // The editor is created once per note; content updates go through setMarkdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const withView = (fn: (view: EditorView) => void) => crepeRef.current?.editor.action((c) => fn(c.get(editorViewCtx)));

  return (
    <>
      <div ref={root} className="note-editor" data-testid="note-editor" />
      {suggest && (
        <WikiSuggest
          ref={suggestRef}
          state={suggest}
          notes={notes.filter((n) => n.id !== noteId)}
          onPick={(title) => withView((v) => completeWikiLink(v, suggest, title))}
        />
      )}
    </>
  );
});
