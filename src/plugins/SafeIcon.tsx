import { Puzzle } from "lucide-react";
import type { Plugin } from "./types";
import { PluginBoundary } from "./Boundary";

/** A plugin's icon, drawn by the app (cards, panel): a plugin whose icon throws gets the puzzle piece and is switched off, instead of taking the screen down. */
export function SafeIcon({ plugin, className }: { plugin: Pick<Plugin, "id" | "name" | "icon" | "builtIn">; className?: string }) {
  const Icon = plugin.icon;
  return (
    <PluginBoundary id={plugin.builtIn ? undefined : plugin.id} plugin={plugin.name} quiet fallback={<Puzzle className={className} />}>
      <Icon className={className} />
    </PluginBoundary>
  );
}
