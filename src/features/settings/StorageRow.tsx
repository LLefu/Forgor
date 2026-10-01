import { useQuery } from "@tanstack/react-query";
import { FolderOpen, RefreshCw } from "lucide-react";
import { Row } from "./Row";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ctx } from "@/data/context";
import { formatBytes } from "@/lib/format";
import { isMac } from "@/lib/keys";
import { revealPath, storageUsage, type Usage } from "@/platform/storage";
import { cn } from "@/lib/utils";

const LABELS: Record<string, { label: string; hint?: string }> = {
  notes: { label: "Notes", hint: "Your .md files" },
  attachments: { label: "Attachments", hint: "Images, files, audio and video in _attachments folders" },
  meetings: { label: "Unassigned recordings", hint: "Meeting notes without a folder (.meetings)" },
  trash: { label: "Trash", hint: "Deleted notes and files until you empty the trash (.trash)" },
  database: { label: "Database", hint: "Todos, settings, search index and version history" },
  "model:speech": { label: "Speech recognition model" },
  "model:speakers": { label: "Speaker separation model" },
  "model:summary": { label: "Summary model" },
  recordings: { label: "Recording audio", hint: "Audio waiting to be transcribed (or kept to try again)" },
  "app-other": { label: "Other app data" },
  cache: { label: "Cache", hint: "Kept by the system's web view; it can clear this itself" },
};

const GROUPS: { title: string; ids: (id: string) => boolean }[] = [
  { title: "In your notes folder", ids: (id) => ["notes", "attachments", "meetings", "trash"].includes(id) },
  { title: "In the app's data folder", ids: (id) => ["database", "recordings", "app-other"].includes(id) || id.startsWith("model:") },
  { title: "Elsewhere", ids: (id) => id === "cache" },
];

/** Settings → Storage: how much Forgor uses on this device, and where. */
export function StorageRow({ desktop }: { desktop: boolean }) {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["storage"],
    queryFn: () => storageUsage(ctx().vault.rootLabel),
    enabled: desktop,
    staleTime: 0,
  });
  const where = isMac ? "Finder" : "Explorer";

  if (!desktop) {
    return (
      <Row label="Storage" hint="What Forgor keeps on this device.">
        <p className="text-xs text-muted-foreground">Available in the desktop app.</p>
      </Row>
    );
  }
  // Hide what isn't there (e.g. models you never downloaded); keep the notes folder and database always.
  const shown = (data ?? []).filter((u) => u.bytes > 0 || ["notes", "database"].includes(u.id));
  const total = shown.reduce((n, u) => n + u.bytes, 0);

  return (
    <Row label="Storage" hint={`What Forgor keeps on this device, and where. The folder button shows it in ${where}.`}>
      <div className="space-y-3" data-testid="storage">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{data ? `${formatBytes(total)} in total` : "Measuring…"}</span>
          <Tooltip content="Measure again">
            <Button size="icon-sm" variant="ghost" onClick={() => void refetch()} aria-label="Measure again" disabled={isFetching}>
              <RefreshCw className={cn(isFetching && "animate-spin")} />
            </Button>
          </Tooltip>
        </div>
        {GROUPS.map((g) => {
          const items = shown.filter((u) => g.ids(u.id));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</div>
              <ul className="divide-y rounded border">
                {items.map((u) => (
                  <UsageLine key={u.id} usage={u} where={where} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Row>
  );
}

function UsageLine({ usage: u, where }: { usage: Usage; where: string }) {
  const info = LABELS[u.id] ?? { label: u.id };
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5" data-testid={`storage-${u.id}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{info.label}</div>
        <div className="truncate text-[11px] text-muted-foreground" title={u.path}>
          {info.hint ? `${info.hint} · ` : ""}
          {u.path}
        </div>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(u.bytes)}</span>
      <Tooltip content={`Show in ${where}`}>
        <Button size="icon-sm" variant="ghost" onClick={() => void revealPath(u.path)} aria-label={`Show ${info.label} in ${where}`}>
          <FolderOpen />
        </Button>
      </Tooltip>
    </li>
  );
}
