/** One setting in a plugin's panel: label and hint above the control (the panel is narrow). */
export function Setting({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * A plugin's icon file. An SVG is used as a shape filled with the current text
 * color (like the app's own icons), so it works in light and dark mode whatever
 * color it was drawn in; a PNG is shown as it is.
 */
export function PluginFileIcon({ url, className }: { url: string; className?: string }) {
  if (url.startsWith("data:image/svg") || /\.svg($|\?)/.test(url)) {
    const mask = `url("${url.replace(/"/g, "%22")}") center / contain no-repeat`;
    return <span aria-hidden className={`inline-block shrink-0 bg-current ${className ?? "size-4"}`} style={{ mask, WebkitMask: mask }} data-testid="plugin-icon-svg" />;
  }
  return <img src={url} alt="" draggable={false} className={`shrink-0 object-contain ${className ?? "size-4"}`} />;
}
