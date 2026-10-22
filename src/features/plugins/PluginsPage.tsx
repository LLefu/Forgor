import { useEffect, useRef, useState } from "react";
import { FileArchive, FolderCode, FolderOpen, Puzzle, RotateCw, Store } from "lucide-react";
import { useUI } from "@/app/store";
import { useModelsStore } from "@/app/models";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { showError } from "@/components/Toasts";
import { localPlugins } from "@/platform/plugins";
import { installPluginFromZip, loadCommunityPlugins } from "@/plugins/community";
import { SafeIcon } from "@/plugins/SafeIcon";
import { FaultLabel, PluginNotes } from "./PluginNotes";
import { refreshStore } from "@/plugins/store";
import { PluginUpdate, StoreBrowser } from "./StoreBrowser";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { PageHeader } from "@/features/todos/TodosPage";
import { MODEL_INFO } from "@/features/models/ModelsSettings";
import { PLUGINS, getPlugin, useEnabledPlugins } from "@/plugins/registry";
import type { Plugin } from "@/plugins/types";
import { cn } from "@/lib/utils";
import { togglePlugin } from "./toggle";

type Tab = "installed" | "store";
const TAB_KEY = "forgor.plugins.tab";

/** Plugins: the installed ones as cards (enabled first; click a card for its panel), and the store. */
export function PluginsPage() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === "store" ? "store" : "installed";
    } catch {
      return "installed";
    }
  });
  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // not remembered
    }
  };
  // Updates and removals show on the installed cards too.
  useEffect(() => void refreshStore(), []);

  return (
    <div className="@container mx-auto max-w-5xl pb-16" data-testid="plugins-page">
      <PageHeader title="Plugins" subtitle="Features you can switch on and off. Disabling a plugin keeps its data, for when you enable it again." icon={<Puzzle className="size-5 text-muted-foreground" />}>
        {tab === "installed" && <InstallButtons />}
      </PageHeader>
      <div className="mb-6 flex gap-1 border-b px-8" role="tablist">
        <TabButton active={tab === "installed"} onClick={() => choose("installed")} testId="plugins-tab-installed">
          <Puzzle className="size-3.5" /> Installed
        </TabButton>
        <TabButton active={tab === "store"} onClick={() => choose("store")} testId="plugins-tab-store">
          <Store className="size-3.5" /> Store
        </TabButton>
      </div>
      {tab === "installed" ? <Installed /> : <StoreBrowser />}
    </div>
  );
}

function TabButton({ active, onClick, testId, children }: { active: boolean; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

function InstallButtons() {
  const reveal = localPlugins().revealFolder;
  const [creating, setCreating] = useState(false);
  const install = async (from: () => Promise<Plugin | null>) => {
    try {
      const plugin = await from();
      if (plugin) useUI.getState().openPluginInfo(plugin.id);
    } catch (e) {
      showError(e, "Couldn't install the plugin");
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      {reveal && (
        <Tooltip content="Open the folder installed plugins live in">
          <Button size="icon" variant="ghost" onClick={() => void reveal().catch((e) => showError(e, "Plugins"))} aria-label="Open plugins folder">
            <FolderOpen />
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Load the plugins again (after changing one)">
        <Button size="icon" variant="ghost" onClick={() => void loadCommunityPlugins()} aria-label="Reload plugins" data-testid="reload-plugins">
          <RotateCw />
        </Button>
      </Tooltip>
      <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="create-plugin-project">
        <FolderCode /> Create plugin project
      </Button>
      <Button size="sm" variant="outline" onClick={() => void install(installPluginFromZip)} data-testid="install-plugin-zip">
        <FileArchive /> Install from zip
      </Button>
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function Installed() {
  const enabled = useEnabledPlugins();
  const disabled = PLUGINS.filter((p) => !enabled.includes(p));
  return (
    <div className="space-y-8 px-8">
      <PluginGrid title="Enabled" plugins={enabled} empty="No plugins enabled yet. Click one below to see what it does." testId="plugins-enabled" />
      <PluginGrid title="Disabled" plugins={disabled} empty="Every plugin is enabled." testId="plugins-disabled" />
    </div>
  );
}

function PluginGrid({ title, plugins, empty, testId }: { title: string; plugins: Plugin[]; empty: string; testId: string }) {
  return (
    <section data-testid={testId}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} <span className="tabular-nums">({plugins.length})</span>
      </h2>
      {plugins.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {plugins.map((p) => (
            <PluginCard key={p.id} plugin={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function PluginCard({ plugin: p }: { plugin: Plugin }) {
  const on = useUI((s) => s.settings.plugins[p.id] === true);
  const [checked, toggle] = useAnimatedToggle(p.id, on);
  const selected = useUI((s) => s.selectedPluginId === p.id);
  const open = () => useUI.getState().openPluginInfo(p.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col gap-3 rounded-lg border bg-background p-4 text-left transition-colors hover:border-ring/60",
        selected && "border-ring ring-1 ring-ring",
        !on && "bg-muted/30",
      )}
      data-testid={`plugin-card-${p.id}`}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>
          <SafeIcon plugin={p} className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("flex items-center text-sm font-semibold", !on && "text-foreground/80")}>
            <span className="truncate">{p.name}</span>
            <FaultLabel plugin={p} />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {p.author} · v{p.version}
            {" · "}
            {sourceLabel(p)}
          </div>
        </div>
        {/* Its own click target: switching doesn't also open the panel. */}
        <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Switch checked={checked} disabled={!!p.error && !checked} onCheckedChange={toggle} aria-label={`${p.name} enabled`} data-testid={`plugin-toggle-${p.id}`} />
        </div>
      </div>
      {p.error ? (
        <p className="line-clamp-3 text-xs text-destructive" data-testid="plugin-error">
          Couldn't load: {p.error}
        </p>
      ) : (
        <p className="line-clamp-3 text-xs text-muted-foreground">{p.description}</p>
      )}
      <PluginNotes plugin={p} compact />
      <Requirements plugin={p} />
      <PluginUpdate plugin={p} />
    </div>
  );
}

export const sourceLabel = (p: Plugin) => (p.builtIn ? "Built-in" : "Community");

/** The switch's slide (Switch: 150 ms), plus a moment to see it. */
const SLIDE_MS = 200;

/**
 * Switching moves the card to the other section, where it is mounted anew
 * (already switched, so without the slide). Show the slide here first, then
 * switch the plugin.
 */
function useAnimatedToggle(id: string, on: boolean): [boolean, (v: boolean) => void] {
  const [pending, setPending] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const toggle = (v: boolean) => {
    setPending(v);
    clearTimeout(timer.current);
    // Back to the real state afterwards (also when the change was cancelled or refused).
    timer.current = setTimeout(() => void togglePlugin(id, v).finally(() => setPending(null)), SLIDE_MS);
  };
  return [pending ?? on, toggle];
}

/** "Needs": the other plugins and the models, at a glance (details in the panel). */
function Requirements({ plugin: p }: { plugin: Plugin }) {
  const models = useModelsStore((s) => s.models);
  const plugins = useUI((s) => s.settings.plugins);
  const parts = [
    ...(p.requires ?? []).map((id) => ({ key: `p:${id}`, label: getPlugin(id)?.name ?? id, ok: plugins[id] === true, optional: false })),
    ...(p.models ?? []).map((m) => ({ key: `m:${m.id}`, label: MODEL_INFO[m.id].label, ok: models.some((x) => x.id === m.id && x.downloaded), optional: !!m.optional })),
  ];
  return (
    <div className="mt-auto flex flex-wrap items-center gap-1 text-[11px]" data-testid={`plugin-needs-${p.id}`}>
      <span className="text-muted-foreground">Needs:</span>
      {parts.length === 0 ? (
        <span className="text-muted-foreground">nothing else</span>
      ) : (
        parts.map((x) => (
          <span key={x.key} className={cn("rounded border px-1.5 py-px", x.ok ? "border-success/40 text-foreground/80" : "border-destructive/50 bg-destructive/10 text-destructive")} title={x.ok ? "Ready" : "Not there yet (see the plugin's panel)"}>
            {x.label}
            {x.optional && " (optional)"}
          </span>
        ))
      )}
    </div>
  );
}
