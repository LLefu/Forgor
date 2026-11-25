import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { replaceAll, insert } from "@milkdown/kit/utils";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { AllSelection, NodeSelection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { Fragment } from "@milkdown/kit/prose/model";
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
import { buildSlashMenu, type ExtraSlashItem } from "./slashMenu";
import { highlight, highlightSchema, runToggleHighlight } from "./highlight";
import { insertToggle, toggle, toggleKeydown } from "./toggle";
import { notionTyping } from "./typing";
import { listColumns } from "./listColumns";
import { linkedTodo, targetsFor, turnInto, type Block, type BlockKind } from "./turnInto";
import { BlockMenu, type BlockMenuState } from "./BlockMenu";
import { chooseDialog } from "@/components/ConfirmDialog";
import { deleteTodo } from "@/data/todos";
import { codePreviews, runSafely, shows, type EditorExtensions } from "@/plugins/editor";
import type { PluginBlock, PluginEditorApi } from "@/plugins/types";
import { codeTheme } from "./codeTheme";
import { cleanMarkdown } from "@/lib/markdown";
import { ACCEPT, fileKind } from "@/lib/files";
import { showError } from "@/components/Toasts";
import type { WriteFn } from "@/platform/writing";

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
  /** Writing tools (the "Ask AI" button in the selection toolbar), from a plugin; null: none. */
  writer?: WriteFn | null;
  /** Before each AI request: save, and keep the current text in the version history. */
  onBeforeAI?: () => Promise<void>;
  /** What enabled plugins add to the editor (plugins/editor.tsx). */
  extensions?: EditorExtensions;
}

const NO_EXTENSIONS: EditorExtensions = { key: "", slashItems: [], blockMenuItems: [], renderers: new Map() };

const highlightIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;

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
  { noteId, notePath, initial, onChange, onOpenMention, onCreateNote, onOpenFile, writer = null, onBeforeAI, extensions = NO_EXTENSIONS },
  ref,
) {
  const root = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const suggestRef = useRef<MentionSuggestHandle>(null);
  const [suggest, setSuggest] = useState<MentionSuggestState | null>(null);
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const [blockMenu, setBlockMenu] = useState<(BlockMenuState & { block: Block }) | null>(null);
  /** Made with each editor: what plugin items get. */
  const helpers = useRef<{ editorApi: () => PluginEditorApi; pluginBlock: (b: Block) => PluginBlock } | null>(null);
  const { data: notes = [] } = useNotes();
  const { data: todos = [] } = useTodos();
  const { data: folders = [] } = useFolders();

  // Latest values for use inside long-lived editor callbacks.
  const live = useRef({ notes, todos, folders, notePath, onChange, onOpenMention, onOpenFile, onBeforeAI, writer, extensions });
  live.current = { notes, todos, folders, notePath, onChange, onOpenMention, onOpenFile, onBeforeAI, writer, extensions };
  const listColumnsOn = useUI((s) => s.settings.listColumns);
  const ai = !!writer;

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

    const previews = codePreviews(() => live.current.extensions);

    /** What a plugin's editor items get: this note, and a way to change it. */
    const editorApi = (): PluginEditorApi => ({
      noteId,
      notePath: live.current.notePath,
      insertMarkdown: (md) => {
        crepe.editor.action((c) => c.get(editorViewCtx).focus());
        crepe.editor.action(insert(md));
      },
      selectedText: () =>
        crepe.editor.action((c) => {
          const { state } = c.get(editorViewCtx);
          return state.doc.textBetween(state.selection.from, state.selection.to, " ");
        }),
    });

    /** A block as plugins see it: its markdown, and a way to replace it. */
    const pluginBlock = (block: Block): PluginBlock =>
      crepe.editor.action((c) => {
        const view = c.get(editorViewCtx);
        const { schema } = view.state;
        const { node, pos } = block;
        // A list item is written as a list of one.
        const wrapped = node.type.name === "list_item" ? view.state.doc.resolve(pos).parent.copy(Fragment.from(node)) : node;
        return {
          type: node.type.name,
          markdown: c.get(serializerCtx)(schema.topNodeType.create(null, wrapped)).trim(),
          replaceWith: (md: string) =>
            crepe.editor.action((c2) => {
              const v = c2.get(editorViewCtx);
              const current = v.state.doc.nodeAt(pos);
              if (!current) return;
              const doc = c2.get(parserCtx)(md);
              v.dispatch(v.state.tr.replaceWith(pos, pos + current.nodeSize, doc.content).scrollIntoView());
            }),
        };
      });

    helpers.current = { editorApi, pluginBlock };

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
            const write = live.current.writer;
            if (!write) throw new Error("The writing tools are off");
            for await (const piece of write({ instruction: c.instruction, selection: c.selection, document: c.document }, signal, (warnings) => {
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
        [Crepe.Feature.CodeMirror]: {
          theme: codeTheme,
          // Plugins' previews (a diagram under a ```mermaid block…); no preview for other languages.
          renderPreview: (language: string, content: string) => previews.render(language, content),
        },
        [Crepe.Feature.Toolbar]: {
          buildToolbar: (builder) => {
            builder.getGroup("formatting").addItem("highlight", {
              icon: highlightIcon,
              label: "Highlight",
              active: (c) => {
                const { state } = c.get(editorViewCtx);
                const type = highlightSchema.type(c);
                const { from, to, empty, $from } = state.selection;
                return empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type);
              },
              onRun: (c) => runToggleHighlight(c),
            });
          },
        },
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
              toggle: (c) => {
                c.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                insertToggle(c.get(editorViewCtx));
              },
              extra: live.current.extensions.slashItems.map(
                ({ plugin, item }): ExtraSlashItem => ({
                  key: `${plugin.id}:${item.id}`,
                  group: plugin.name,
                  label: item.label,
                  icon: item.icon,
                  keywords: item.keywords,
                  onRun: (c) => {
                    c.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                    runSafely(plugin, () => item.run(editorApi()));
                  },
                }),
              ),
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
      .use(highlight)
      .use(toggle)
      .use(notionTyping(() => useUI.getState().settings.notionTyping))
      .use(listColumns(() => useUI.getState().settings.listColumns))
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

    // A click on the drag handle (no drag) opens the block's menu. The handle selected the block on mousedown.
    const onHandleClick = (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest?.(".milkdown-block-handle .operation-item");
      if (!handle || handle !== handle.parentElement?.lastElementChild || !crepeRef.current) return;
      const view = crepe.editor.action((c) => c.get(editorViewCtx));
      const sel = view.state.selection;
      if (!(sel instanceof NodeSelection)) return;
      const block: Block = { node: sel.node, pos: sel.from };
      const kinds = targetsFor(block, view.state);
      const asPlugin = pluginBlock(block);
      const extra = live.current.extensions.blockMenuItems
        .filter(({ plugin, item }) => shows(plugin, item.show && (() => item.show!(asPlugin))))
        .map(({ plugin, item }) => ({ id: `${plugin.id}:${item.id}`, label: item.label, group: plugin.name }));
      if (!kinds.length && !extra.length) return;
      setBlockMenu({ rect: handle.getBoundingClientRect(), kinds, extra, block });
    };
    document.addEventListener("click", onHandleClick);

    // Toggle keys, before ProseMirror and Crepe's plugins (which take Backspace first).
    const onKeydown = (e: KeyboardEvent) => {
      if (!crepeRef.current || e.defaultPrevented) return;
      const view = crepe.editor.action((c) => c.get(editorViewCtx));
      // ProseMirror only reads a moved cursor (⌘← …) when it handles the key itself: catch up first, as it does.
      (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
      if (toggleKeydown(view, e)) e.stopPropagation();
    };
    el.addEventListener("keydown", onKeydown, true);

    // ⌘⇧H (the shortcut registry sends it to whichever editor has the focus).
    const onCommand = (e: Event) => {
      if ((e as CustomEvent).detail !== "highlight" || !crepeRef.current) return;
      crepe.editor.action((c) => c.get(editorViewCtx).hasFocus() && runToggleHighlight(c));
    };
    window.addEventListener("editor-command", onCommand);

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
      document.removeEventListener("click", onHandleClick);
      el.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("editor-command", onCommand);
      previews.destroy();
      if (crepeRef.current === crepe) {
        crepeRef.current = null;
        void crepe.destroy();
      }
    };
    // The editor is created once per note (and again when writing tools are turned on or off); content updates go through setMarkdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, ai, extensions.key]);

  // List columns on/off: draw the decorations again.
  useEffect(() => {
    withView((v) => v.dispatch(v.state.tr.setMeta("list-columns", listColumnsOn)));
  }, [listColumnsOn]);

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

  /** Turn into: a todo line that stops being one asks what happens to its todo first. */
  const onTurnInto = async (block: Block, kind: BlockKind) => {
    const todoId = kind === "todo" ? null : linkedTodo(block);
    let trash = false;
    if (todoId) {
      const title = todos.find((t) => t.id === todoId)?.title;
      const choice = await chooseDialog({
        title: "This line is a todo",
        message: `${title ? `“${title}” is` : "It's"} a todo. After this it's no longer in the note. Keep the todo, or move it to the Trash?`,
        choices: [
          { id: "trash", label: "Move todo to Trash" },
          { id: "keep", label: "Keep the todo" },
        ],
      });
      if (!choice) return;
      trash = choice === "trash";
    }
    withView((v) => {
      // The note may have changed while the dialog was open: only go on if the block is still there.
      const node = v.state.doc.nodeAt(block.pos);
      if (!node || !node.eq(block.node)) return;
      const tr = turnInto(v.state, { node, pos: block.pos }, kind);
      if (tr) v.dispatch(tr.scrollIntoView());
      v.focus();
    });
    if (trash && todoId) await deleteTodo(todoId);
  };

  const onBlockExtra = (block: Block, id: string) => {
    const found = extensions.blockMenuItems.find(({ plugin, item }) => `${plugin.id}:${item.id}` === id);
    if (!found) return;
    const { plugin, item } = found;
    const h = helpers.current;
    if (!h) return;
    runSafely(plugin, () => item.run(h.pluginBlock(block), h.editorApi()));
  };

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
      {blockMenu && (
        <BlockMenu
          state={blockMenu}
          onClose={() => setBlockMenu(null)}
          onTurnInto={(kind) => void onTurnInto(blockMenu.block, kind).catch(showError)}
          onExtra={(id) => onBlockExtra(blockMenu.block, id)}
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
