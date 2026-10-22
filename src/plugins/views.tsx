import { Puzzle } from "lucide-react";
import { useUI, type PluginView } from "@/app/store";
import { Button } from "@/components/ui/button";
import type { Folder } from "@/data/types";
import { PageHeader } from "@/features/todos/TodosPage";
import { getPlugin, useEnabledPlugins } from "./registry";
import { openPluginSettings, usePluginEnabled } from "./host";
import type { NoteHeaderProps } from "./types";
import { PluginBoundary } from "./Boundary";

/**
 * Where the app shows plugins' contributions. Only enabled plugins show up;
 * a tab of a disabled plugin's page stays (with a way to enable it).
 */

export function PluginPageView({ view }: { view: PluginView }) {
  const plugin = getPlugin(view.plugin);
  const enabled = usePluginEnabled(view.plugin);
  const page = plugin?.pages?.[view.page];
  if (!plugin || !page) return <Unavailable title="This page is gone" message="The plugin that made it isn't installed anymore, or no longer has this page." />;
  if (!enabled)
    return (
      <Unavailable title={plugin.name} message={`${plugin.name} is disabled. Its data is kept; enable it to see this page again.`}>
        <Button size="sm" variant="outline" onClick={() => openPluginSettings(plugin.id)}>
          Open in Plugins
        </Button>
      </Unavailable>
    );
  const Page = page.component;
  return (
    <PluginBoundary id={plugin.id} plugin={plugin.name}>
      <Page param={view.param} />
    </PluginBoundary>
  );
}

function Unavailable({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title={title} icon={<Puzzle className="size-5 text-muted-foreground" />} />
      <div className="mx-8 flex items-center gap-3 rounded border bg-muted/40 p-3 text-sm" data-testid="plugin-unavailable">
        <span className="flex-1">{message}</span>
        {children}
      </div>
    </div>
  );
}

const missingTab = () => ({ label: "Missing page", icon: Puzzle });

/** A plugin page's tab label and icon. Mount once per plugin page (the hook comes from the page). */
export function usePluginTab(view: PluginView) {
  const useTab = getPlugin(view.plugin)?.pages?.[view.page]?.useTab ?? missingTab;
  return useTab(view.param);
}

/** The open plugin panel (e.g. a Jira ticket), when its plugin is enabled. */
export function PluginPanelView() {
  const panel = useUI((s) => s.pluginPanel);
  const enabled = usePluginEnabled(panel?.plugin ?? "");
  const Panel = panel && enabled ? getPlugin(panel.plugin)?.panels?.[panel.panel] : undefined;
  if (!panel || !Panel) return null;
  return (
    <PluginBoundary id={panel.plugin} plugin={getPlugin(panel.plugin)?.name ?? panel.plugin}>
      <Panel key={`${panel.plugin}/${panel.panel}/${panel.param}`} param={panel.param} fromFolder={panel.fromFolder ?? null} />
    </PluginBoundary>
  );
}

export function PluginSidebarItems() {
  const plugins = useEnabledPlugins();
  return (
    <>
      {plugins.map((p) => {
        const Item = p.sidebar;
        return Item ? (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name} quiet>
            <Item />
          </PluginBoundary>
        ) : null;
      })}
    </>
  );
}

export function PluginFolderSections({ folder }: { folder: Folder }) {
  const plugins = useEnabledPlugins();
  return (
    <>
      {plugins.map((p) => {
        const Section = p.folderSection;
        return Section ? (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name}>
            <Section folder={folder} />
          </PluginBoundary>
        ) : null;
      })}
    </>
  );
}

/** Plugins' numbers on the Today page (inside its grid of cards; a card that crashes just disappears). */
export function PluginTodayCards() {
  const plugins = useEnabledPlugins();
  return (
    <>
      {plugins.map((p) => {
        const Cards = p.today?.cards;
        return Cards ? (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name} quiet>
            <Cards />
          </PluginBoundary>
        ) : null;
      })}
    </>
  );
}

/** Plugins' lists on the Today page. */
export function PluginTodaySections() {
  const plugins = useEnabledPlugins();
  return (
    <>
      {plugins.map((p) => {
        const Section = p.today?.section;
        return Section ? (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name}>
            <Section />
          </PluginBoundary>
        ) : null;
      })}
    </>
  );
}

/** Plugins' parts of a note's top bar: `slot` "breadcrumb" (before the folder path) or "actions" (buttons). */
export function PluginNoteHeader({ slot, ...props }: NoteHeaderProps & { slot: "breadcrumb" | "actions" }) {
  const plugins = useEnabledPlugins();
  return (
    <>
      {plugins.map((p) => {
        const Part = p.noteHeader?.[slot];
        return Part ? (
          <PluginBoundary key={p.id} id={p.id} plugin={p.name} quiet>
            <Part {...props} />
          </PluginBoundary>
        ) : null;
      })}
    </>
  );
}
