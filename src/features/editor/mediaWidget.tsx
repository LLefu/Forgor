import { createRoot } from "react-dom/client";
import { MediaPlayer } from "./MediaPlayer";
import type { MediaSpec } from "./linkPlugins";

/** Render the React player into a ProseMirror widget element. */
export function renderMedia(el: HTMLElement, spec: MediaSpec & { src: string; onOpenExternal: () => void }): () => void {
  const root = createRoot(el);
  root.render(
    <MediaPlayer kind={spec.kind} src={spec.src} name={spec.name} width={spec.width} onResize={spec.onResize} onOpenExternal={spec.onOpenExternal} />,
  );
  // Unmount outside ProseMirror's update cycle (React warns about synchronous unmounts during render).
  return () => setTimeout(() => root.unmount(), 0);
}
