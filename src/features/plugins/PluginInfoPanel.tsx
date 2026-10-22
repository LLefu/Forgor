import { useState } from "react";
import { CheckCircle2, FileArchive, Trash2, Upload, X } from "lucide-react";
import { useUI } from "@/app/store";
import { setNotificationOn } from "@/app/notifications";
import { useResizableWidth } from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RequiredModels } from "@/features/models/ModelsSettings";
import { getPlugin } from "@/plugins/registry";
import { togglePlugin } from "./toggle";
import { sourceLabel } from "./PluginsPage";
import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { exportPlugin, installPlugin, pickUpdateZip, uninstallPlugin } from "@/plugins/community";
import { newerVersion, useStoreEntry, usePluginStore } from "@/plugins/store";
import type { Plugin } from "@/plugins/types";
import { PluginBoundary } from "@/plugins/Boundary";
import { SafeIcon } from "@/plugins/SafeIcon";
import { FaultLabel, PluginNotes } from "./PluginNotes";
import { PublishDialog } from "./PublishDialog";

/** A plugin in the right-hand panel: what it is, what it needs, and its settings. */
export function PluginInfoPanel({ id }: { id: string }) {
  const plugin = getPlugin(id);
  const on = useUI((s) => s.settings.plugins[id] === true);
  const plugins = useUI((s) => s.settings.plugins);
  const { width, handle } = useResizableWidth("panelWidth", { min: 300, max: 720, edge: "left" });
  if (!plugin) return null;
  const Settings = plugin.settings;

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l bg-background" style={{ width }} data-testid="plugin-panel">
      {handle}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="truncate text-xs text-muted-foreground">Plugin</span>
        <Button size="icon" variant="ghost" onClick={() => useUI.getState().openPluginInfo(null)} aria-label="Close">
          <X />
        </Button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-8 pt-4">
        <header className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <SafeIcon plugin={plugin} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center text-base font-semibold">
              {plugin.name}
              <FaultLabel plugin={plugin} />
            </h2>
            <p className="text-xs text-muted-foreground">
              by {plugin.author} · v{plugin.version}
              {" · "}
              {sourceLabel(plugin)}
            </p>
          </div>
        </header>

        <label className="flex items-center gap-2 rounded border px-3 py-2">
          <span className="flex-1 text-sm">{on ? "Enabled" : "Disabled"}</span>
          <Switch checked={on} disabled={!!plugin.error && !on} onCheckedChange={(v) => void togglePlugin(plugin.id, v)} aria-label={`${plugin.name} enabled`} data-testid="plugin-enabled" />
        </label>

        {plugin.error && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="plugin-error">
            Couldn't load this plugin: {plugin.error}
          </p>
        )}
        <p className="text-sm text-foreground/85">{plugin.description}</p>
        <PluginNotes plugin={plugin} />

        <PanelSection title="Requires">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Plugins</div>
              {plugin.requires?.length ? (
                <ul className="space-y-1">
                  {plugin.requires.map((rid) => (
                    <li key={rid} className="flex items-center gap-1.5 text-[13px]">
                      {getPlugin(rid)?.name ?? rid}
                      {plugins[rid] ? <CheckCircle2 className="size-3.5 text-success" aria-label="Enabled" /> : <span className="text-xs text-destructive">· not enabled (enabled along with this one)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">No other plugins</p>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">AI models</div>
              {plugin.models?.length ? <RequiredModels models={plugin.models} testId="plugin-models" /> : <p className="text-[13px] text-muted-foreground">None</p>}
            </div>
          </div>
        </PanelSection>

        {plugin.notifications?.length ? (
          <PanelSection title="Notifications">
            {on ? <NotificationSwitches plugin={plugin} /> : <p className="text-[13px] text-muted-foreground">Enable the plugin to choose its notifications.</p>}
          </PanelSection>
        ) : null}

        {Settings && (
          <PanelSection title="Settings">
            {on ? (
              <div className="space-y-5" data-testid="plugin-settings">
                <PluginBoundary id={plugin.builtIn ? undefined : plugin.id} plugin={plugin.name}>
                  <Settings />
                </PluginBoundary>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">Enable the plugin to change its settings.</p>
            )}
          </PanelSection>
        )}

        <p className="text-xs text-muted-foreground">Disabling a plugin hides it everywhere but keeps its data (notes, links, accounts), for when you enable it again.</p>

        {plugin.source && !plugin.error && <ShareSection plugin={plugin} />}

        {plugin.source === "installed" && <ManageSection plugin={plugin} />}
      </div>
    </aside>
  );
}

/** An installed community plugin: a new version from a zip, or uninstall it. */
function ManageSection({ plugin }: { plugin: Plugin }) {
  const [busy, setBusy] = useState(false);
  const updateFromZip = async () => {
    setBusy(true);
    try {
      const picked = await pickUpdateZip(plugin);
      if (!picked) return;
      if (!newerVersion(picked.version, plugin.version)) {
        const ok = await confirmDialog({
          title: `Install v${picked.version}?`,
          message: `That zip has v${picked.version}, and v${plugin.version} is installed now. Install it anyway?`,
          confirmLabel: `Install v${picked.version}`,
        });
        if (!ok) return;
      }
      await installPlugin(picked.files);
    } catch (e) {
      showError(e, `Couldn't update ${plugin.name}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PanelSection title="Installed version">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateFromZip()} data-testid="update-from-zip">
            <FileArchive /> Update from zip
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Uninstall ${plugin.name}?`,
                message: "Its files are removed. What it stored is kept, for when you install it again.",
                confirmLabel: "Uninstall",
                destructive: true,
              });
              if (ok) await uninstallPlugin(plugin.id, false).catch((e) => showError(e, "Couldn't uninstall"));
            }}
            data-testid="uninstall-plugin"
          >
            <Trash2 /> Uninstall
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">v{plugin.version} is installed. Got a newer version as a zip? Update it here; its settings and data stay.</p>
      </div>
    </PanelSection>
  );
}

/** A community plugin: save it as a zip, or put it in the store. */
function ShareSection({ plugin }: { plugin: Plugin }) {
  const entry = useStoreEntry(plugin.id);
  const loaded = usePluginStore((s) => s.plugins !== null);
  const [publishing, setPublishing] = useState(false);
  const canPublish = loaded && !entry?.removed && (!entry || newerVersion(plugin.version, entry.version));
  return (
    <PanelSection title="Share">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void exportPlugin(plugin.id).catch((e) => showError(e, "Couldn't export"))} data-testid="export-plugin">
            <FileArchive /> Export as zip
          </Button>
          <Button size="sm" variant="outline" disabled={!canPublish} onClick={() => setPublishing(true)} data-testid="publish-plugin">
            <Upload /> {entry ? `Publish v${plugin.version}` : "Publish to store"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {!loaded
            ? "Checking the store…"
            : entry?.removed
              ? `It was taken out of the store: ${entry.removed}`
              : entry && !canPublish
                ? `The store has v${entry.version}. Raise the version in its manifest.json to publish a new one.`
                : entry
                  ? `The store has v${entry.version}.`
                  : "Not in the store yet. Publishing makes it available to everyone."}
        </p>
      </div>
      {publishing && <PublishDialog plugin={plugin} entry={entry} onClose={() => setPublishing(false)} />}
    </PanelSection>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** A switch per kind of notification the plugin sends (muted ones are in settings.notificationsMuted). */
function NotificationSwitches({ plugin }: { plugin: Plugin }) {
  const muted = useUI((s) => s.settings.notificationsMuted);
  const allOn = useUI((s) => s.settings.notificationsEnabled);
  return (
    <div className="space-y-3" data-testid="plugin-notifications">
      {!allOn && (
        <p className="text-xs text-warning">
          Notifications are off for all of Forgor.{" "}
          <button className="underline underline-offset-2" onClick={() => useUI.getState().setView({ kind: "settings" })}>
            Turn them on in Settings
          </button>
          .
        </p>
      )}
      {plugin.notifications!.map((n) => {
        const on = !muted.includes(`${plugin.id}:${n.kind}`);
        const Options = n.settings;
        return (
          <div key={n.kind}>
            <label className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{n.label}</span>
                {n.hint && <span className="block text-xs text-muted-foreground">{n.hint}</span>}
              </span>
              <Switch checked={on} onCheckedChange={(v) => void setNotificationOn(plugin.id, n.kind, v)} aria-label={n.label} data-testid={`notify-${plugin.id}-${n.kind}`} />
            </label>
            {on && Options && (
              <div className="mt-1.5">
                <PluginBoundary id={plugin.id} plugin={plugin.name}>
                  <Options />
                </PluginBoundary>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
