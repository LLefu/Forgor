import { useMemo } from "react";
import type { PluginApi, PluginFactory } from "@forgor/plugin-api";
import { PluginIcon } from "./icon";
import "./styles.css";

let api: PluginApi;

const NAME = %%NAME_JSON%%;

/**
 * The plugin. Forgor calls this once when it loads the plugin;
 * return what it adds to the app. See AGENTS.md for every option.
 */
const plugin: PluginFactory = (forgor) => {
  api = forgor;
  return {
    icon: PluginIcon,
    sidebar: () => <api.ui.NavItem icon={PluginIcon} label={NAME} target={{ kind: "plugin", plugin: api.id, page: "main" }} />,
    pages: {
      main: {
        useTab: () => ({ label: NAME, icon: PluginIcon }),
        component: MainPage,
      },
    },
    settings: Settings,
    // Listed in Settings → Shortcuts under the plugin's name, where the user can change it.
    shortcuts: [{ id: "open", label: `Open ${NAME}`, keys: ["Mod+Alt+H"], run: () => api.app.openPage("main") }],
  };
};

export default plugin;

function MainPage() {
  const { data: notes = [] } = api.app.useNotes();
  const [greeting] = api.storage.useValue("greeting", "Hello");
  const recent = useMemo(() => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5), [notes]);

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <api.ui.PageHeader title={NAME} subtitle={`${greeting}! You have ${notes.length} notes.`} icon={<PluginIcon className="size-5 text-muted-foreground" />}>
        <api.ui.Button size="sm" onClick={() => void api.data.notes.createNote("", `New note from ${NAME}`).then((n) => api.app.openNote(n.id))}>
          New note
        </api.ui.Button>
      </api.ui.PageHeader>
      <div className="px-8">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recently edited</h2>
        <ul className="divide-y rounded-lg border">
          {recent.map((n) => (
            <li key={n.id}>
              <button className="w-full px-3 py-2 text-left text-sm hover:bg-muted" {...api.ui.noteLinkProps(n.id)}>
                {n.title || "Untitled"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Settings() {
  const [greeting, setGreeting] = api.storage.useValue("greeting", "Hello");
  return (
    <api.ui.Setting label="Greeting" hint="Shown at the top of the page.">
      <api.ui.Input value={greeting} onChange={(e) => void setGreeting(e.target.value)} aria-label="Greeting" />
    </api.ui.Setting>
  );
}
