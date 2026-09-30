import { isMac } from "./keys";

/** The steps Ctrl/⌘ +/- walk through, like a browser. */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Next level up (dir 1) or down (dir -1); an off-list value snaps to its neighbour. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_LEVELS.find((z) => z > current + 0.001) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find((z) => z < current - 0.001) ?? ZOOM_LEVELS[0];
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/** Ctrl/⌘ + "=" or "+" zooms in, "-" out, "0" resets (with or without Shift, numpad too). */
export function zoomAction(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey">): "in" | "out" | "reset" | null {
  if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Numpad0") return "reset";
  return null;
}
