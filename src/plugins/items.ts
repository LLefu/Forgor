import { useQuery } from "@tanstack/react-query";
import { addRemoteQueries, queryClient } from "@/app/queries";
import { useUI } from "@/app/store";
import { onDataChange } from "@/data/context";
import { enabledPlugins } from "./host";
import type { Plugin, PluginItem } from "./types";

/**
 * Items from every enabled plugin's `items` (Jira tickets, pull requests, a
 * community plugin's mail…) as one list, for pages that combine them (an
 * overview). Sources return cached data; one failing source doesn't hide the
 * others, it's listed in `errors`.
 */

export interface Item extends PluginItem {
  /** The plugin it comes from. */
  source: string;
  sourceName: string;
  /** What it is ("Jira ticket"). */
  kind: string;
}

export interface ItemsResult {
  items: Item[];
  errors: { source: string; sourceName: string; message: string }[];
}

const KEY = "plugin-items";
// Not refreshed on every autosave: the sources' own data refreshes on its own schedule (see below).
addRemoteQueries([KEY]);
// A folder link changes which folder an item belongs to.
onDataChange((topics) => {
  if (topics.includes("folders")) void queryClient.invalidateQueries({ queryKey: [KEY] });
});

const isFiniteOrNull = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));
const textOrNull = (v: unknown) => v === undefined || v === null || typeof v === "string";

/** Drops what a (community) source got wrong instead of letting it break the page that shows it. */
function usable(i: PluginItem): boolean {
  return (
    typeof i === "object" &&
    i !== null &&
    typeof i.id === "string" &&
    typeof i.title === "string" &&
    typeof i.open === "function" &&
    textOrNull(i.key) &&
    textOrNull(i.status) &&
    textOrNull(i.createdAt) &&
    textOrNull(i.updatedAt) &&
    textOrNull(i.dueDate) &&
    textOrNull(i.folderId) &&
    textOrNull(i.url) &&
    isFiniteOrNull(i.estimateMin)
  );
}

export async function listItems(plugins: Plugin[] = enabledPlugins()): Promise<ItemsResult> {
  const sources = plugins.filter((p) => p.items);
  const results = await Promise.allSettled(sources.map((p) => p.items!.items()));
  const out: ItemsResult = { items: [], errors: [] };
  results.forEach((r, n) => {
    const p = sources[n];
    if (r.status === "rejected" || !Array.isArray(r.value)) {
      const message = r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : "items() didn't return a list";
      console.warn(`Items of ${p.name} failed:`, message);
      out.errors.push({ source: p.id, sourceName: p.name, message });
      return;
    }
    for (const i of r.value) if (usable(i)) out.items.push({ ...i, source: p.id, sourceName: p.name, kind: p.items!.kind });
  });
  return out;
}

/** All enabled plugins' items, kept fresh (every minute, on focus, when folders change). */
export function useItems(): ItemsResult & { isLoading: boolean; refresh: () => Promise<unknown> } {
  useUI((s) => s.settings.plugins); // re-render when plugins are switched on/off (a new list of plugins remounts the app)
  const ids = enabledPlugins()
    .filter((p) => p.items)
    .map((p) => p.id);
  const q = useQuery({ queryKey: [KEY, ...ids], queryFn: () => listItems(), staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true });
  return { items: q.data?.items ?? [], errors: q.data?.errors ?? [], isLoading: q.isLoading, refresh: q.refetch };
}
