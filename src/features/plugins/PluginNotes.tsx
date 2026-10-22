import { useUI } from "@/app/store";
import { needsNewerApp } from "@/plugins/compat";
import type { Plugin } from "@/plugins/types";

/** "Error": a plugin that was switched off because it caused a problem (next to its name). */
export function FaultLabel({ plugin }: { plugin: Plugin }) {
  const fault = useUI((s) => s.settings.pluginFaults[plugin.id]);
  if (!fault || plugin.builtIn) return null;
  return (
    <span className="ml-1.5 shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-destructive" data-testid="plugin-fault-label">
      Error
    </span>
  );
}

/**
 * What to know about a community plugin besides what it does: why it was
 * switched off, what was ignored in what it declared, and which Forgor it was
 * made for (a warning when that's newer than this one). `compact` is for the card.
 */
export function PluginNotes({ plugin, compact }: { plugin: Plugin; compact?: boolean }) {
  const fault = useUI((s) => s.settings.pluginFaults[plugin.id]);
  if (plugin.builtIn) return null;
  const warnings = plugin.warnings ?? [];
  const shown = compact ? warnings.slice(0, 1) : warnings;
  const newerApp = needsNewerApp(plugin.minAppVersion);
  return (
    <div className="space-y-1">
      {fault && (
        <p className={compact ? "line-clamp-3 text-xs text-destructive" : "rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"} data-testid="plugin-fault">
          Switched off after an error ({fault.where}): {fault.message}
          {!compact && <span className="mt-1 block">Switch it on again to give it another try.</span>}
        </p>
      )}
      {plugin.deferred && !compact && <p className="text-xs text-muted-foreground">Not loaded: it was switched off after an error. Switching it on loads it again.</p>}
      {shown.map((w) => (
        <p key={w} className={compact ? "line-clamp-2 text-xs text-warning" : "text-xs text-warning"} data-testid="plugin-warning">
          {w}
        </p>
      ))}
      {compact && warnings.length > shown.length && <p className="text-xs text-warning">+{warnings.length - shown.length} more in its details</p>}
      {plugin.minAppVersion && !newerApp && (
        <p className="text-xs text-muted-foreground" data-testid="plugin-made-for">
          Made for Forgor {plugin.minAppVersion}
        </p>
      )}
    </div>
  );
}
