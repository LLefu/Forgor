import { useEffect, useRef, useState } from "react";
import { useUI } from "@/app/store";
import { DEFAULT_SETTINGS } from "@/data/settings";
import { cn } from "@/lib/utils";

type WidthKey = "sidebarWidth" | "panelWidth";

/**
 * Width of a resizable side panel, plus a drag handle for its inner edge.
 * The width updates live while dragging and is saved when you let go;
 * double-click the handle to reset it.
 */
export function useResizableWidth(key: WidthKey, { min, max, edge }: { min: number; max: number; edge: "left" | "right" }) {
  const saved = useUI((s) => s.settings[key]);
  const update = useUI((s) => s.updateSetting);
  const [width, setWidth] = useState(saved);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => setWidth(saved), [saved]);

  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max, w, window.innerWidth - 360)));

  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize"
      title="Drag to resize · double-click to reset"
      className={cn(
        "group absolute inset-y-0 z-20 w-1.5 cursor-col-resize",
        edge === "right" ? "-right-[3px]" : "-left-[3px]",
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startW: width };
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.startX;
        setWidth(clamp(drag.current.startW + (edge === "right" ? dx : -dx)));
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        document.body.classList.remove("resizing");
        void update(key, width);
      }}
      onDoubleClick={() => {
        setWidth(DEFAULT_SETTINGS[key]);
        void update(key, DEFAULT_SETTINGS[key]);
      }}
      data-testid={`resize-${key}`}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-ring group-active:bg-ring" />
    </div>
  );
  return { width, handle };
}
