import iconSvg from "../icon.svg?raw";

const url = `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`;
const mask = `url("${url}") center / contain no-repeat`;

/**
 * icon.svg as a React icon: its shape, filled with the current text color, so
 * it matches Forgor's own icons in light and dark mode (the app draws the file
 * the same way in the store). Use it wherever the plugin shows its icon.
 */
export function PluginIcon({ className }: { className?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 bg-current ${className ?? "size-4"}`} style={{ mask, WebkitMask: mask }} />;
}
