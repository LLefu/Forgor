import { useEffect, useState } from "react";
import { useUI } from "./store";
import { isTauri } from "@/platform/env";
import { setWindowZoom } from "@/platform/zoom";
import { stepZoom, zoomAction, zoomLabel } from "@/lib/zoom";

/**
 * Applies `settings.zoom` to the window and handles Ctrl/⌘ +, - and 0.
 * Desktop only: in the browser build those keys keep doing the browser's own zoom.
 */
export function useZoom() {
  const zoom = useUI((s) => s.settings.zoom);
  useEffect(() => {
    void setWindowZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    if (!isTauri()) return;
    const onKey = (e: KeyboardEvent) => {
      const action = zoomAction(e);
      if (!action) return;
      e.preventDefault();
      const { settings, updateSetting } = useUI.getState();
      const next = action === "reset" ? 1 : stepZoom(settings.zoom, action === "in" ? 1 : -1);
      if (next !== settings.zoom) void updateSetting("zoom", next);
      showZoomIndicator(next); // also at the limit, to show where we are
    };
    // Capture phase, so the editor never swallows it.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

const indicatorListeners = new Set<(zoom: number) => void>();
function showZoomIndicator(zoom: number) {
  for (const l of indicatorListeners) l(zoom);
}

/** Briefly shows the zoom level after a zoom shortcut, like a browser does. */
export function ZoomIndicator() {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (z: number) => {
      setShown(z);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(null), 1200);
    };
    indicatorListeners.add(show);
    return () => {
      indicatorListeners.delete(show);
      clearTimeout(timer);
    };
  }, []);
  if (shown === null) return null;
  return (
    <div
      role="status"
      data-testid="zoom-indicator"
      className="pointer-events-none fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded border bg-popover px-3 py-1.5 text-sm font-medium shadow-lg"
    >
      {zoomLabel(shown)}
    </div>
  );
}
