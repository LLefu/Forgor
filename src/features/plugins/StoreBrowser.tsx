import { useMemo, useState } from "react";
import { BadgeCheck, Check, Download, Flag, Loader2, Puzzle, RefreshCw, Search } from "lucide-react";
import { useUI } from "@/app/store";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { showError } from "@/components/Toasts";
import type { StorePlugin } from "@/platform/store";
import { PLUGINS, usePluginsVersion } from "@/plugins/registry";
import { confirmUnverifiedInstall } from "@/plugins/community";
import { confirmMadeForNewerApp, installFromStore, newerVersion, refreshStore, reportPlugin, updateFor, usePluginStore } from "@/plugins/store";
import type { Plugin } from "@/plugins/types";
import { needsNewerApp, newerAppWarning } from "@/plugins/compat";
import { PluginFileIcon } from "@/plugins/ui";

/** Plugins → Store: everyone's plugins, to install with one click. */
export function StoreBrowser() {
  const { plugins, loading, error } = usePluginStore();
  usePluginsVersion((s) => s.version); // installed state changes the buttons
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (plugins ?? []).filter((p) => !p.removed && (!q || [p.name, p.author, p.description, p.id].some((t) => t.toLowerCase().includes(q))));
  }, [plugins, query]);

  return (
    <div className="px-8" data-testid="store">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search plugins" className="pl-8" aria-label="Search plugins" data-testid="store-search" />
        </div>
        <Tooltip content="Refresh">
          <Button size="icon" variant="ghost" onClick={() => void refreshStore()} disabled={loading} aria-label="Refresh the store">
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </Tooltip>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Plugins made by other people. Anyone can publish one, so install what you trust: a plugin can do anything Forgor can. Publish your own from its panel (Installed tab).
      </p>
      {error && !plugins ? (
        <p className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="store-error">
          {error}
        </p>
      ) : !plugins ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the store…
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="store-empty">
          {query.trim() ? `No plugins match “${query.trim()}”.` : "No plugins in the store yet. Be the first: publish one from its panel."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {shown.map((p) => (
            <StoreCard key={p.id} entry={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function StoreCard({ entry }: { entry: StorePlugin }) {
  const installed = PLUGINS.find((p) => p.id === entry.id);
  const [reporting, setReporting] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-4" data-testid={`store-card-${entry.id}`}>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
          {entry.iconUrl ? <PluginFileIcon url={entry.iconUrl} className="size-5" /> : <Puzzle className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm font-semibold">
            <span className="truncate">{entry.name}</span>
            {entry.verified && (
              <Tooltip content="Checked by Forgor">
                <BadgeCheck className="size-4 shrink-0 text-primary" aria-label="Verified" />
              </Tooltip>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {entry.author} · v{entry.version} · {entry.installs} {entry.installs === 1 ? "install" : "installs"}
          </div>
        </div>
      </div>
      <p className="line-clamp-3 text-xs text-muted-foreground">{entry.description}</p>
      {entry.minAppVersion && (
        <p className={needsNewerApp(entry.minAppVersion) ? "text-xs text-warning" : "text-xs text-muted-foreground"} data-testid="store-made-for">
          {needsNewerApp(entry.minAppVersion) ? newerAppWarning(entry.minAppVersion) : `Made for Forgor ${entry.minAppVersion}`}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        <InstallButton entry={entry} installed={installed} />
        <Tooltip content="Report this plugin">
          <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={() => setReporting(true)} aria-label={`Report ${entry.name}`}>
            <Flag />
          </Button>
        </Tooltip>
      </div>
      {reporting && <ReportDialog entry={entry} onClose={() => setReporting(false)} />}
    </div>
  );
}

function InstallButton({ entry, installed }: { entry: StorePlugin; installed: Plugin | undefined }) {
  const [busy, setBusy] = useState(false);
  const install = async () => {
    // Plugins with the check mark (Forgor's own, or checked) and updates install without asking.
    if (!installed && !entry.verified && !(await confirmUnverifiedInstall(entry))) return;
    if (!(await confirmMadeForNewerApp(entry))) return;
    setBusy(true);
    try {
      const plugin = await installFromStore(entry);
      useUI.getState().openPluginInfo(plugin.id);
    } catch (e) {
      showError(e, `Couldn't install ${entry.name}`);
    } finally {
      setBusy(false);
    }
  };
  if (installed?.builtIn) return <span className="text-xs text-muted-foreground">Built into Forgor</span>;
  if (installed && !newerVersion(entry.version, installed.version))
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="store-installed">
        <Check className="size-3.5 text-success" /> Installed
      </span>
    );
  return (
    <Button size="sm" variant={installed ? "outline" : "default"} disabled={busy} onClick={() => void install()} data-testid={`store-install-${entry.id}`}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />} {installed ? `Update to v${entry.version}` : "Install"}
    </Button>
  );
}

/** On an installed plugin's card: a newer version in the store, or that it was taken out. */
export function PluginUpdate({ plugin }: { plugin: Plugin }) {
  const store = usePluginStore((s) => s.plugins);
  const [busy, setBusy] = useState(false);
  const entry = store?.find((p) => p.id === plugin.id);
  if (plugin.source === "installed" && entry?.removed)
    return (
      <p className="text-xs text-destructive" data-testid="plugin-removed">
        Taken out of the store: {entry.removed}
      </p>
    );
  const update = updateFor(plugin, store);
  if (!update) return null;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          if (!(await confirmMadeForNewerApp(update))) return;
          setBusy(true);
          await installFromStore(update)
            .catch((e) => showError(e, `Couldn't update ${plugin.name}`))
            .finally(() => setBusy(false));
        }}
        data-testid={`plugin-update-${plugin.id}`}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Update to v{update.version}
      </Button>
    </div>
  );
}

function ReportDialog({ entry, onClose }: { entry: StorePlugin; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Report ${entry.name}`} className="w-[440px]" data-testid="report-dialog">
        {sent ? (
          <div className="space-y-3 text-sm">
            <p>Thanks. Forgor's maintainer will look at it; a plugin that is harmful is taken out of the store and turned off for everyone.</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await reportPlugin(entry.id, reason.trim());
                setSent(true);
              } catch (err) {
                showError(err, "Couldn't send the report");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong with it? (broken, harmful, spam, someone else's…)" rows={4} autoFocus aria-label="Reason" />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !reason.trim()} data-testid="report-send">
                Send report
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
