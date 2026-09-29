import { useUI } from "./store";

/**
 * Click handlers for anything that opens a note: a normal click and a middle
 * click both open it in a tab (an already open tab is reused).
 */
export function noteLinkProps(noteId: string, after?: () => void) {
  const open = () => {
    useUI.getState().setView({ kind: "note", id: noteId });
    after?.();
  };
  return {
    onClick: open,
    // Stop the browser's middle-click auto-scroll.
    onMouseDown: (e: React.MouseEvent) => e.button === 1 && e.preventDefault(),
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      open();
    },
  };
}
