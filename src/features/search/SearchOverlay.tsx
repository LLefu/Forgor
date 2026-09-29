import { useEffect } from "react";
import { useUI } from "@/app/store";
import { SearchPanel } from "./SearchView";

/**
 * Ctrl/⌘+Shift+F: the search page as a floating panel over whatever is open.
 * Escape or a click outside closes it; opening a result closes it too.
 */
export function SearchOverlay() {
  const open = useUI((s) => s.searchOverlay);
  const setOpen = useUI((s) => s.setSearchOverlay);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Let an open dropdown/date picker inside the panel handle Escape first.
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("[role=dialog], [role=listbox], [role=menu]")) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/25"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
      data-testid="search-overlay"
    >
      <div className="mx-auto mt-[8vh] flex max-h-[76vh] w-[720px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded border bg-popover shadow-2xl">
        <div className="min-h-0 overflow-y-auto p-4">
          <SearchPanel onDone={() => setOpen(false)} />
        </div>
      </div>
    </div>
  );
}
