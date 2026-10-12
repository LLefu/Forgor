import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { replaceAll, insert } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { AllSelection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { streamingPluginKey } from "@milkdown/kit/plugin/streaming";
import { clearDiffReviewCmd, diffPluginKey } from "@milkdown/kit/plugin/diff";
import "@milkdown/crepe/theme/common/style.css";
import "./editor.css";
import { useUI } from "@/app/store";
import { useFolders, useNotes, useTodos } from "@/app/queries";
import { ctx } from "@/data/context";
import { listAttachments, saveAttachment } from "@/data/notes";
import { pickAttachment, type PickKind } from "@/components/AttachmentPicker";
import { basename, dirname, relativePath, resolvePath } from "@/lib/paths";
import { escapeLinkText, mentionHref, type MentionKind } from "@/lib/mentions";
import { assignMarkersInView, filePastePlugin, inlineTodoDecorations, reviewKeys } from "./plugins";
import {
  currentFind,
  findPlugin,
  insertMention,
  linkPlugin,
  mentionSuggestPlugin,
  refreshLinks,
  setFind,
  setLinkHref,
  showAsEmbed,
  unlink,
  type MentionSuggestState,
  type MentionTarget,
} from "./linkPlugins";
import { MentionSuggest, type MentionPick, type MentionSuggestHandle } from "./MentionSuggest";
import { MentionMenu, type MentionMenuState } from "./MentionMenu";
import { renderEmbed } from "./embed";
import { renderMedia } from "./mediaWidget";
import { installImageResize } from "./imageResize";
import { buildSlashMenu } from "./slashMenu";
import { codeTheme } from "./codeTheme";
import { cleanMarkdown } from "@/lib/markdown";
import { ACCEPT, fileKind } from "@/lib/files";
import { showError } from "@/components/Toasts";
import { writer } from "@/platform/writing";

export interface NoteEditorHandle {
  /** Replace content (external change). */
  setMarkdown: (md: string) => void;
  getMarkdown: () => string;
  focus: () => void;
  /** Find in this note: set the query and/or step to a match. */
  find: (patch: { query?: string; step?: 1 | -1 }) => { index: number; count: number };
  /** Selected text (to prefill the find bar). */
  selectedText: () => string;
  /** Writing tools: rewrite the selection, or the whole note when nothing is selected. */
  runAI: (instruction: string) => void;
}

interface Props {
  noteId: string;
  notePath: string;
  initial: string;
  onChange: (markdown: string) => void;
  /** Open what an "@" link points at. */
  onOpenMention: (kind: MentionKind, id: string) => void;
  /** Create a note for "@new title" and return it. */
  onCreateNote: (title: string) => Promise<{ id: string; title: string }>;
  onOpenFile: (vaultPath: string) => void;
  /** Writing tools (the "Ask AI" button in the selection toolbar). */
  ai?: boolean;
  /** Before each AI request: save, and keep the current text in the version history. */
  onBeforeAI?: () => Promise<void>;
}

/**
 * What the writing tools get: the selected markdown, exactly the range the reply
 * replaces. Crepe's own version falls back to plain text when the selection
 * can't be serialized, which would drop images and links from what the model
 * sees and then replace them with its reply; this refuses instead.
 */
function aiContext(state: EditorState, serialize: (doc: ProseNode) => string, instruction: string) {
  const document = serialize(state.doc);
  const { from, to, empty } = state.selection;
  if (empty) return { document, selection: "", instruction };
  if (from === 0 && to === state.doc.content.size) return { document, selection: document, instruction };
  const { content } = state.doc.slice(from, to);
  const { schema } = state;
  const wrapper = schema.topNodeType.createAndFill(null, content) ?? schema.topNodeType.createAndFill(null, schema.nodes.paragraph?.createAndFill(null, content) ?? null);
  if (!wrapper) throw new Error("This selection can't be rewritten as a whole. Select whole paragraphs or list items.");
  return { document, selection: serialize(wrapper), instruction };
}

const isExternal = (url: string) => /^(https?:|data:|blob:|asset:|http:\/\/asset\.localhost)/.test(url);

export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(
  { noteId, notePath, initial, onChange, onOpenMention, onCreateNote, onOpenFile, ai = false, onBeforeAI },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const suggestRef = useRef<MentionSuggestHandle>(null);
  const [suggest, setSuggest] = useState<MentionSuggestState | null>(null);
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const { data: notes = [] } = useNotes();
  const { data: todos = [] } = useTodos();
  const { data: folders = [] } = useFolders();

  // Latest values for use inside long-lived editor callbacks.
  const live = useRef({ notes, todos, folders, notePath, onChange, onOpenMention, onOpenFile, onBeforeAI });
  live.current = { notes, todos, folders, notePath, onChange, onOpenMention, onOpenFile, onBeforeAI };

  const withView = <T,>(fn: (view: EditorView) => T): T | undefined => crepeRef.current?.editor.action((c) => fn(c.get(editorViewCtx)));

  useImperativeHandle(ref, () => ({
    setMarkdown: (md) => crepeRef.current?.editor.action(replaceAll(md, true)),
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? "",
    focus: () => crepeRef.current?.editor.action((c) => c.get(editorViewCtx).focus()),
    find: ({ query, step }) => {
      const result =
        withView((v) => {
          if (query !== undefined) return setFind(v, { query, index: 0 });
          return setFind(v, { index: (currentFind(v)?.index ?? 0) + (step ?? 0) });
        }) ?? { index: 0, count: 0 };
      // Bring the current match into view.
      requestAnimationFrame(() => root.current?.querySelector(".find-current")?.scrollIntoView({ block: "center" }));
      return result;
    },
    selectedText: () =>
      withView((v) => {
        const { from, to } = v.state.selection;
        return v.state.doc.textBetween(from, to, " ");
      }) ?? "",
    runAI: (instruction) =>
      crepeRef.current?.editor.action((c) => {
        const view = c.get(editorViewCtx);
        // Focus first: focusing reads the browser's selection back, which can't span an image and shrank "the whole note" to its first paragraph.
        view.focus();
        const { doc, selection } = view.state;
        if (selection.empty) view.dispatch(view.state.tr.setSelection(new AllSelection(doc)));
        // By name: importing runAICmd from "@milkdown/crepe/feature/ai" gives a second copy whose key the editor doesn't know.
        c.get(commandsCtx).call("RunAI", { instruction });
      }),
  }));

  useEffect(() => {
    if (!root.current) return;
    let disposed = false;
    const toDisplayUrl = (url: string) => {
      if (!url || isExternal(url)) return url;
      return ctx().vault.fileUrl(resolvePath(dirname(live.current.notePath), url));
    };

    /** Insert a link (or image) to a vault file. Video/audio links sit alone on their line, which gives them a player. */
    const insertFile = (kind: PickKind, vaultPath: string) => {
      const rel = encodeURI(relativePath(dirname(live.current.notePath), vaultPath));
      const label = escapeLinkText(basename(vaultPath));
      const view = crepe.editor.action((c) => c.get(editorViewCtx));
      view.focus();
      if (kind === "image") crepe.editor.action(insert(`![](${rel})`));
      else {
        const media = fileKind(vaultPath) === "video" || fileKind(vaultPath) === "audio";
        crepe.editor.action(insert(media ? `[${label}](${rel})` : `[${label}](${rel}) `, true));
      }
    };

    /** OS file dialog → copy into _attachments → insert. */
    const upload = (kind: PickKind) => {
      const input = document.createElement("input");
      input.type = "file";
      if (kind !== "document") input.accept = ACCEPT[kind];
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        const { path } = await saveAttachment(noteId, file.name, new Uint8Array(await file.arrayBuffer()));
        insertFile(kind, path);
      });
      input.click();
    };

    /** /document, /image, /video, /audio: choose a file already in the folder, or upload one (straight away if there are none). */
    const attachFile = async (kind: PickKind) => {
      const existing = (await listAttachments(dirname(live.current.notePath))).filter((f) => kind === "document" || fileKind(f) === kind);
      if (!existing.length) return upload(kind);
      const choice = await pickAttachment(kind, existing);
      if (choice?.type === "existing") insertFile(kind, choice.path);
      else if (choice?.type === "upload") upload(kind);
    };

    const crepe = new Crepe({
      root: root.current,
      defaultValue: initial,
      features: { [Crepe.Feature.AI]: ai, [Crepe.Feature.Latex]: false, [Crepe.Feature.TopBar]: false },
      featureConfigs: {
        // Writing tools: the reply streams in and is shown as a diff to accept or reject.
        [Crepe.Feature.AI]: {
          provider: async function* (c, signal) {
            await live.current.onBeforeAI?.(); // a restore point in the version history, whatever happens next
            let wrote = "";
            for await (const piece of writer()({ instruction: c.instruction, selection: c.selection, document: c.document }, signal, (warnings) => {
              if (warnings.length) showError(`Check before accepting: the AI's version ${warnings.join(" and ")}.`, "Writing tools");
            })) {
              wrote += piece;
              yield piece;
            }
            // An empty reply would show as "delete the selection"; failing puts the text back (Crepe aborts the stream).
            if (!wrote.trim() && !signal.aborted) throw new Error("The AI didn't write anything. Try describing what you want a bit more.");
          },
          buildAISuggestions: (b) => void b.clear(), // just the prompt
          buildContext: (c, instruction) => aiContext(c.get(editorViewCtx).state, c.get(serializerCtx), instruction),
          instructionPlaceholder: "What should AI do with this?",
          onError: (e) => showError(e.cause ?? e, "Writing tools"),
        },
        [Crepe.Feature.Placeholder]: { text: "Start writing… type / for blocks, @ to link a note or todo, - [ ] for a todo", mode: "doc" },
        [Crepe.Feature.CodeMirror]: { theme: codeTheme },
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file) => (await saveAttachment(noteId, file.name, new Uint8Array(await file.arrayBuffer()))).rel,
          proxyDomURL: toDisplayUrl,
        },
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) =>
            buildSlashMenu(builder as unknown as Parameters<typeof buildSlashMenu>[0], {
              linkNote: (c) => {
                // "/note": same as typing "@", but only notes are offered.
                c.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                const view = c.get(editorViewCtx);
                setOnlyNotes(true);
                view.dispatch(view.state.tr.insertText("@"));
                view.focus();
              },
              attachFile: (c, kind) => {
                c.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                void attachFile(kind);
              },
            }),
        },
      },
    });

    const exists = (kind: MentionKind, id: string) => {
      const l = live.current;
      if (kind === "todo") return l.todos.some((t) => t.id === id);
      if (kind === "folder") return l.folders.some((f) => f.id === id);
      return l.notes.some((n) => n.id === id);
    };

    crepe.editor
      .use(inlineTodoDecorations((id) => useUI.getState().openTodo(id)))
      .use(
        linkPlugin({
          exists,
          onMentionClick: (target, rect, direct) => {
            if (direct) live.current.onOpenMention(target.kind === "embed" ? "note" : target.kind, target.id);
            else setMenu({ target, rect });
          },
          onOpenFile: (href) => live.current.onOpenFile(resolvePath(dirname(live.current.notePath), href)),
          renderMedia: (el, spec) => {
            const path = resolvePath(dirname(live.current.notePath), spec.href);
            return renderMedia(el, { ...spec, src: ctx().vault.fileUrl(path), onOpenExternal: () => live.current.onOpenFile(path) });
          },
          renderEmbed,
          onEmbedShowAsLink: (t) => withView((v) => setLinkHref(v, t.from, t.to, mentionHref("note", t.id))),
        }),
      )
      .use(
        mentionSuggestPlugin({
          onChange: (s) => {
            setSuggest(s.active ? s : null);
            if (!s.active) setOnlyNotes(false);
          },
          onKey: (key) => suggestRef.current?.onKey(key) ?? false,
        }),
      )
      .use(findPlugin())
      .use(reviewKeys(() => crepe.editor.action((c) => c.get(commandsCtx).call(clearDiffReviewCmd.key))))
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
      api.markdownUpdated((c, markdown, prev) => {
        if (markdown === prev) return;
        // Writing tools: while text streams in (and during the review) the note keeps its old text until accepted.
        const state = c.get(editorViewCtx).state;
        if (streamingPluginKey.getState(state)?.active || diffPluginKey.getState(state)?.active) return;
        live.current.onChange(cleanMarkdown(markdown));
        // After a pause, give new "- [ ]" items a todo marker (creates the todo on save).
        clearTimeout(markerTimer);
        markerTimer = setTimeout(() => {
          const added = crepe.editor.action((c) => assignMarkersInView(c.get(editorViewCtx)));
          // The marker transaction is kept out of undo history, and Milkdown's listener
          // doesn't report such transactions, so hand the new markdown over ourselves.
          if (added) live.current.onChange(cleanMarkdown(crepe.getMarkdown()));
        }, 900);
      });
    });

    // Crepe's link preview (shows the URL) is pointless for "@" links; keep hover events away from it there.
    const el = root.current;
    const blockPreview = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-mention-id], .note-embed")) e.stopPropagation();
    };
    el.addEventListener("mousemove", blockPreview, true);
    // Links in a note are handled by our plugins. Never let the webview follow an <a> itself:
    // Milkdown blanks unknown hrefs (forgor://…), and Ctrl+click on that opened the app URL in the browser.
    const stopNavigation = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest?.("a")) e.preventDefault();
    };
    // Middle click on a link opens it (a note opens in a tab).
    const middleClick = (e: MouseEvent) => {
      if (e.button !== 1) return;
      const m = (e.target as HTMLElement).closest?.("[data-mention-id]") as HTMLElement | null;
      if (!m) return;
      e.preventDefault();
      const kind = m.dataset.mentionKind as MentionKind;
      live.current.onOpenMention(kind === "embed" ? "note" : kind, m.dataset.mentionId!);
    };
    const noAutoscroll = (e: MouseEvent) => e.button === 1 && (e.target as HTMLElement).closest?.("a") && e.preventDefault();
    el.addEventListener("click", stopNavigation, true);
    el.addEventListener("auxclick", stopNavigation, true);
    el.addEventListener("auxclick", middleClick);
    el.addEventListener("mousedown", noAutoscroll, true);
    const stopImageResize = installImageResize(el, () => crepeRef.current?.editor.action((c) => c.get(editorViewCtx)));

    void crepe.create().then(() => {
      if (disposed) void crepe.destroy();
      else crepeRef.current = crepe;
    });

    return () => {
      disposed = true;
      clearTimeout(markerTimer);
      el.removeEventListener("mousemove", blockPreview, true);
      el.removeEventListener("click", stopNavigation, true);
      el.removeEventListener("auxclick", stopNavigation, true);
      el.removeEventListener("auxclick", middleClick);
      el.removeEventListener("mousedown", noAutoscroll, true);
      stopImageResize();
      if (crepeRef.current === crepe) {
        crepeRef.current = null;
        void crepe.destroy();
      }
    };
    // The editor is created once per note (and again when writing tools are turned on or off); content updates go through setMarkdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, ai]);

  // Re-check "@" links (missing or not) when notes, todos or folders change.
  useEffect(() => {
    withView(refreshLinks);
  }, [notes, todos, folders]);

  const pick = async (p: MentionPick) => {
    const s = suggest;
    if (!s) return;
    if (p.kind === "create-note") {
      const created = await onCreateNote(p.title);
      withView((v) => insertMention(v, s.from, s.to, created.title, "note", created.id));
    } else {
      withView((v) => insertMention(v, s.from, s.to, p.title, p.kind, p.id));
    }
  };

  const onMenu = (fn: (v: EditorView, t: MentionTarget) => void) => () => menu && withView((v) => fn(v, menu.target));

  return (
    <>
      <div ref={root} className="note-editor" data-testid="note-editor" />
      {suggest && (
        <MentionSuggest
          ref={suggestRef}
          state={suggest}
          notes={notes.filter((n) => n.id !== noteId)}
          todos={todos}
          folders={folders}
          onlyNotes={onlyNotes}
          onPick={(p) => void pick(p)}
        />
      )}
      {menu && (
        <MentionMenu
          state={menu}
          onClose={() => setMenu(null)}
          onOpen={() => onOpenMention(menu.target.kind === "embed" ? "note" : menu.target.kind, menu.target.id)}
          onEmbed={onMenu((v, t) => showAsEmbed(v, t))}
          onShowAsLink={onMenu((v, t) => setLinkHref(v, t.from, t.to, mentionHref("note", t.id)))}
          onUnlink={onMenu((v, t) => unlink(v, t.from, t.to))}
        />
      )}
    </>
  );
});
