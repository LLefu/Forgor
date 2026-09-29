import type { EditorView } from "@milkdown/kit/prose/view";

const MIN_WIDTH = 100;

/**
 * Images resize like videos: drag the bottom-right corner, the image stays
 * left-aligned. Crepe's own handle resizes by height from the bottom centre;
 * we intercept its pointerdown and store the result in the same place Crepe
 * does (the image block's `ratio`, saved in the markdown), so Crepe keeps
 * rendering the size correctly afterwards.
 */
export function installImageResize(root: HTMLElement, getView: () => EditorView | undefined): () => void {
  const onDown = (e: PointerEvent) => {
    const handle = (e.target as HTMLElement).closest?.(".image-resize-handle");
    if (!handle || e.button !== 0) return;
    const block = handle.closest(".milkdown-image-block") as HTMLElement | null;
    const img = block?.querySelector(".image-wrapper img") as HTMLImageElement | null;
    if (!block || !img || !img.naturalWidth) return;
    // Keep Crepe's (vertical) handler from running.
    e.preventDefault();
    e.stopPropagation();

    const aspect = img.naturalHeight / img.naturalWidth;
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const maxW = block.getBoundingClientRect().width;
    let height = img.getBoundingClientRect().height;

    const move = (ev: PointerEvent) => {
      const w = Math.max(MIN_WIDTH, Math.min(maxW, startW + ev.clientX - startX));
      height = w * aspect;
      img.style.height = `${height.toFixed(2)}px`;
      img.dataset.height = height.toFixed(2);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-media");
      const origin = Number(img.dataset.origin);
      const view = getView();
      if (!view || !origin) return;
      const ratio = Number.parseFloat((height / origin).toFixed(2));
      // Find the image block node that owns this DOM element.
      let pos: number | null = null;
      view.state.doc.descendants((node, p) => {
        if (pos !== null) return false;
        if (node.type.name !== "image-block") return;
        const dom = view.nodeDOM(p);
        if (dom === block || (dom instanceof HTMLElement && dom.contains(block))) pos = p;
      });
      if (pos === null) return;
      const node = view.state.doc.nodeAt(pos)!;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ratio }));
    };
    document.body.classList.add("resizing-media");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  root.addEventListener("pointerdown", onDown, true);
  return () => root.removeEventListener("pointerdown", onDown, true);
}
