import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { ctx, onDataChange } from "@/data/context";
import { readNote } from "@/data/notes";
import { dirname, resolvePath } from "@/lib/paths";

const isExternal = (url: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);

/**
 * "Show entire note": a read-only rendering of another note inside the
 * current one. It follows changes to that note. Links inside it are not
 * clickable and nested embeds show as plain links (no infinite nesting).
 */
export function renderEmbed(host: HTMLElement, noteId: string): () => void {
  host.innerHTML = "";
  const body = document.createElement("div");
  body.className = "note-embed-body";
  host.append(body);

  let disposed = false;
  let editor: Editor | null = null;
  let lastBody: string | null = null;

  const load = async () => {
    const note = await readNote(noteId).catch(() => null);
    if (disposed) return;
    if (!note) {
      body.textContent = "This note no longer exists.";
      lastBody = null;
      return;
    }
    const md = note.body.replace(/\s?\^t-[a-z0-9]+/g, "");
    if (md === lastBody) return;
    lastBody = md;
    const old = editor;
    editor = null;
    await old?.destroy();
    if (disposed) return;
    body.innerHTML = "";
    if (!md.trim()) {
      body.innerHTML = '<p class="note-embed-empty">This note is empty.</p>';
      return;
    }
    const created = await Editor.make()
      .config((c) => {
        c.set(rootCtx, body);
        c.set(defaultValueCtx, md);
        c.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => false }));
      })
      .use(commonmark)
      .use(gfm)
      .create();
    if (disposed) {
      void created.destroy();
      return;
    }
    editor = created;
    // Relative image paths point into the vault.
    const dir = dirname(note.meta.path);
    body.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (src && !isExternal(src)) img.src = ctx().vault.fileUrl(resolvePath(dir, src));
    });
  };

  void load();
  const off = onDataChange((topics) => topics.includes("notes") && void load());
  return () => {
    disposed = true;
    off();
    void editor?.destroy();
  };
}
