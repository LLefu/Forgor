# %%NAME%%: a Forgor plugin

Read this before changing anything. It covers what you need to build this plugin, from scratch if necessary, without the Forgor source code.

## What Forgor is

Forgor is a desktop notes and tasks app (Tauri: a native window running a web page; React 19, TypeScript, Tailwind v4). Notes are plain markdown files in a folder the user picks. Todos, settings and an index live in a local SQLite database. It runs on macOS and Windows. There's also a browser build for development.

A **plugin** adds things to Forgor: sidebar items (with a count), pages, right-hand panels, a section in a folder's panel, buttons in a note's top bar, settings, quick-menu entries, desktop notifications and background work. Forgor's own features are built the same way: the built-in plugins Meeting recordings, Writing tools, Jira and Bitbucket. Plugins run inside the app's web page, with the same access as the app: the user's notes, todos, settings and the app's UI (see "What the page allows" for the limits). Users install them from a zip file or from the in-app store, then turn them on and off on the Plugins page. Before installing a plugin that Forgor hasn't checked (no check mark in the store, or any zip), Forgor shows a warning that says what plugins can do.

## This project

| Path | What it is |
|---|---|
| `manifest.json` | The plugin's identity: `id`, `name`, `version`, `author`, `description`, optional `minAppVersion`, `requires`, `models` |
| `src/index.tsx` | The plugin: `export default (api) => ({ …contributions })` |
| `src/styles.css` | Its CSS (Tailwind utilities against Forgor's theme) |
| `icon.svg` | The plugin's icon: on its card, in the store, and (through `src/icon.tsx`) in the sidebar and tab. See "Icon" |
| `src/icon.tsx` | `PluginIcon`: `icon.svg` as a React icon in the current text color. Use it wherever the plugin shows its icon |
| `types/forgor-plugin-api.d.ts` | **The API's exact types.** Read it when unsure what something takes or returns. Don't edit it |
| `forgor/theme.css` | Forgor's design tokens for Tailwind. Don't edit it |
| `vite.config.ts` | The build. Keep the output format, file names and externals as they are |
| `scripts/zip.mjs` | Packs `dist/` into `<id>-<version>.zip` |

Commands:

```sh
npm install        # once
npm run zip        # build + zip: <id>-<version>.zip, what Forgor installs
npm run build      # only build into dist/
npm run typecheck  # TypeScript, against the API types
```

**Trying it:** `npm run zip`, then in Forgor **Plugins → Install from zip**, confirm the warning (every zip gets it), and turn it on. After a change: `npm run zip` again, click the plugin on the Plugins page and use **Update from zip** in its panel. With the same version number it asks to confirm first; that's fine while developing. Settings and stored data stay.

## How Forgor runs a plugin

- `main.js` is **one CommonJS file**. Forgor runs it and calls its default export with the `api` object, once when it loads plugins (at startup, after installing, updating or reloading). Do no work at load time: no fetches, timers or listeners in the factory itself. Put them in `start`.
- `require` only gives the app's own `react`, `react/jsx-runtime` and `react-dom`. They stay external in the build, because a second copy of React breaks hooks. **Everything else must be bundled** (npm packages you `import` get bundled by Vite automatically). There is no Node.js: no `fs`, `path`, `process` or child processes. You get browser APIs (`fetch`, `localStorage`, `crypto.subtle`, …).
- **`fetch`** to other sites only works if they allow cross-origin requests (CORS). Many APIs do; some don't.
- **Disabled means hidden:** the app only shows a plugin's contributions while it's enabled. Disabling stops `start` (its returned cleanup runs) and hides everything. It never deletes the plugin's stored data.
- **Crashes:** a component that throws is caught. The app shows a short notice and an error toast, and the rest keeps working. A factory that throws makes the plugin "couldn't load", shown with the error on its card.
- **Styles:** `styles.css` is added to the page while the plugin is enabled.

## What the page allows

Forgor limits what its page (and so every plugin) can do, so a mistake or a bad plugin can't reach the rest of the computer. Build with these limits in mind; things outside them fail with a "Content Security Policy" or "forbidden path" error in the console:

- **Scripts:** only the app's own and your `main.js`. You can't load scripts from other sites (`<script src="https://…">`, CDNs) or add `<script>` tags. Bundle every library into `main.js` (`import` it; Vite does the rest).
- **CSS and fonts:** your `styles.css` and inline styles work. Stylesheets and web fonts from other sites (Google Fonts, CDNs) don't: use the app's fonts (Inter is already there), or bundle a font into your CSS as a `data:` URL.
- **Network:** `fetch` and WebSockets to `https://` / `wss://` sites (if they allow CORS), and to `http://localhost` / `127.0.0.1` for local services. Plain `http://` to other hosts is blocked.
- **Images, audio, video:** from `https://`, `http://`, `data:` and `blob:` URLs, and the user's attachments.
- **Embeds:** `<iframe>` only with `https://` pages. Forms can't submit to a URL; use `fetch`.
- **Files:** no file system. The notes go through `api.data`; your own data through `api.storage`. Forgor itself can only reach the notes folder and its own plugin files, never the rest of the disk, and it never opens programs or scripts.

## manifest.json

```json
{
  "id": "%%ID%%",
  "name": "%%NAME%%",
  "version": "1.0.0",
  "author": "Your name",
  "description": "One or two sentences: what it does.",
  "minAppVersion": "%%APP_VERSION%%"
}
```

- **`id`** is lowercase letters, digits and dashes, and unique in the store. The built-in plugins' ids (`meetings`, `writing`, `jira`, `bitbucket`) and `forgor` are taken. Never change it after publishing: it's how Forgor recognises the plugin, its updates and its stored data.
- **`version`** is `x.y.z`. Raise it for every version you hand out or publish; the store refuses the same or a lower version.
- **`requires`** lists ids of other plugins it needs; they're turned on along with it.
- **`models`** lists the local AI models it uses: `[{ "id": "language", "for": "summaries", "optional": true }]`. The ids are `speech`, `speakers`, `language`. They're shown in the plugin's panel with a download button.

## What a plugin can add (contribution points)

All optional. The exact types are in `PluginDefinition` in `types/forgor-plugin-api.d.ts`.

| Key | What |
|---|---|
| `icon` | Component for its card (lucide-react icons work: `import { X } from "lucide-react"`) |
| `settings` | Component shown in its panel on the Plugins page. Stack `api.ui.Setting` blocks; the panel is narrow (~400 px) |
| `sidebar` | Component rendered in the sidebar below All tasks. Use `api.ui.NavItem`; its `count` shows a number on the right (like Jira's open tickets), `alert` makes it red. Only count what needs the user's attention |
| `pages` | `{ [name]: { useTab(param) → { label, icon }, component({ param }) } }`. Open with `api.app.openPage(name, param)` or a `NavItem` with `target={{ kind: "plugin", plugin: api.id, page: name }}`. Pages share the page tab; `param` is a string (e.g. a folder id) |
| `panels` | Right-hand panels: `{ [name]: ({ param, fromFolder }) => … }`. One panel shows at a time (todo, folder, plugin info, or yours) |
| `folderSection` | `({ folder }) => …`, a section in a folder's panel (use `api.ui.Section`) |
| `noteHeader` | `{ breadcrumb, actions }`: components in a note's top bar, given `{ note, editor }` |
| `hosts` | Components always mounted while enabled, for dialogs you open from anywhere |
| `start` | `() => stop`. Runs while enabled: listeners, timers, polling. **Return a function that undoes everything** |
| `useQuickMenu` | `(enabled) => ({ items, status?, title? })`. Entries in the quick menu (global shortcut popup). It's a hook and is called even while disabled: return `{ items: [] }` when `enabled` is false |
| `useWriter` | A hook returning a writing function for the editor's AI tools, or null |
| `disableBlocked` | `() => reason or null`, e.g. "Stop the recording first." |
| `remoteQueries` | First parts of TanStack query keys you fetch from the internet, so they aren't refreshed on every local change |
| `notifications` | The kinds of desktop notifications it sends: `[{ kind: "mention", label: "New mentions", hint: "When someone mentions you." }]`. Its panel gets a switch for each (see `api.notifications`) |

`useTab`, `useQuickMenu` and `useWriter` are hooks: call them the same way every time (no conditions or loops around hooks).

## The API (`api`)

Keep it in a module variable (`let api: PluginApi;` assigned in the factory), so components can use it.

- **`api.id`**: your plugin id.
- **`api.app`:**
  - `useUI(selector)` / `useUI.getState()`: the app's UI state (`view`, `tabs`, `settings`, `selectedFolderId`…, plus `setView`, `openFolder`, `openTodo`, `closePanel`).
  - `openPage(page, param?)`, `openNote(id)`, `openFolder(id | null)` (the folder's panel), `openTodo(id | null)`, `openSettings()` (your panel).
  - `on("folder-open", folderId => …)` returns an unsubscribe function; use it in `start`.
  - `useEnabled()`.
  - `useFolders()`, `useNotes()`, `useTodos()`: React hooks returning `{ data, isLoading, … }`. They're always fresh: any change refreshes them.
  - `useQuery({ queryKey, queryFn, staleTime?, refetchInterval?, refetchOnWindowFocus?, enabled? })`: a query on the app's own TanStack client, returning `{ data, isLoading, isFetching, error, refetch }`. Everything using the same key shares one cache and one request. Start keys with your plugin id; for data from the internet, list that id in `remoteQueries` (else every local change refetches it).
  - `queryClient.invalidateQueries({ queryKey })` (refetch) and `queryClient.fetchQuery(options)` (the data, from the cache while fresh: for checks outside React, like notifications).
- **`api.data.notes`:** `listFolders`, `listNotes`, `getNoteMeta`, `readNote(id)` (`{ meta, data, body }`, where `body` is the markdown), `createNote(folderPath, title?, body?)`, `writeNoteBody(id, markdown)`, `renameNote`, `moveNote(id, folderPath)`, `trashNote`, `createFolder(parentPath, name)`, `relocateFolder(id, newPath)`, `trashFolder`, `setFolderColor`, `backlinks(noteId)`.
  - Paths are relative to the notes folder (`"Clients/Acme"`; `""` is the top level).
  - Write through these functions, never to the files directly; they keep the index, links and todos right, and the app refreshes by itself.
- **`api.data.todos`:** `listTodos`, `getTodo`, `listSubtasks`, `createTodo({ title, dueDate: "YYYY-MM-DD", priority: 1-4, folderId, … })`, `updateTodo(id, patch)`, `setDone(id, done)`, `deleteTodo`, `linkNote`, `unlinkNote`, `notesForTodo`, `todosForNote`.
- **`api.storage`:** your plugin's own data, JSON values, stored on this computer in the app's database (not in the notes folder, not synced):
  - `await get(key, fallback)`, `await set(key, value)`;
  - in components, `const [value, setValue] = useValue(key, fallback)`.
  - Keep it small: settings, ids and small lists. It survives disabling, updating and uninstalling.
- **`api.notifications`:** desktop notifications (macOS Notification Center, Windows), only for the kinds you list in `notifications`. The user switches each kind off in your panel, or all of Forgor's in Settings; Forgor asks the system for permission.
  - `poll(check, everyMs?)`: runs `check` soon and then every 5 minutes (or `everyMs`); returns how to stop. Call it in `start` and return that: `start: () => api.notifications.poll(async () => { … })`. It runs in the main window, also while Forgor is hidden in the tray, never after it's quit.
  - `notifyNew(kind, items, options?)`: pass everything you currently see as `{ id, title, body }` (stable ids). It notifies only about ids it hasn't seen before and remembers them (in your storage). The **first** call for a kind only takes stock, so installing doesn't flood the user; pass `{ baseline: false }` when you already filtered on "new since last time". More than three new at once become one notification (`summary: (n) => ({ title, body })`).
  - `notify(kind, { title, body, open? })`: one notification right away (for something that just happened in the app).
  - Every notification is also kept in Forgor's notification history (the bell next to Settings). Give items an `open: { page, pageParam?, panel?, panelParam? }` (your own pages and panels) so clicking one there opens what it's about.
  - Keep titles short ("Sanne commented on WEB-12") and the body one line. Clicking the desktop notification itself only brings Forgor to the front; the history is where it opens the right place.
- **`api.ui`:** the app's components; use them so the plugin looks like Forgor.
  - Components: `Button` (`variant`: default, secondary, outline, ghost, destructive; `size`: default, sm, icon, icon-sm), `Input`, `Textarea`, `Switch` (`checked`, `onCheckedChange`), `Select` (`value`, `onChange`, `options`), `Dialog` + `DialogContent` (`title`), `Tooltip` (`content`), `NavItem`, `Setting`, `PageHeader` (`title`, `subtitle`, `icon`, children on the right), `Section`, `FolderGlyph`, `FolderLabel`.
  - Helpers: `useFolderColor(id)`, `confirmDialog({ title, message, confirmLabel, destructive })` (returns a promise of a boolean), `showError(error, context)` (an error toast), `noteLinkProps(noteId)` (spread on anything that opens a note), `cn(...classes)`.
- **`api.lib`:** `basename`, `dirname`, `joinPath`, `effectiveFolderColor`, `colorHex`.
- **`api.platform`:** `isTauri()` (false in the browser build), `openExternal(url)` (the default browser).

## Styling

- Use Tailwind utility classes in your components. They're built into `dist/styles.css` from the classes you actually use.
- **Use the theme's colors, not fixed ones**, so dark mode and the user's highlight color work: `bg-background`, `bg-muted`, `bg-sidebar`, `bg-popover`, `text-foreground`, `text-muted-foreground`, `border` (uses `--border`), `bg-primary` / `text-primary-foreground`, `bg-accent` / `text-accent-foreground`, `text-destructive`, `text-success`, `text-warning`, `ring-ring`. Opacity works: `bg-primary/10`. In inline styles use the variables: `var(--muted)`, `var(--primary)`…
- Corners are small (`rounded` = 4px, `rounded-sm` = 2px). The base text is 14px; Forgor uses `text-[13px]` for lists and `text-xs` for hints. Icons are usually `size-4`, `size-3.5` in small places.
- **Pages:** `mx-auto max-w-3xl pb-16` (or `max-w-5xl` for grids), `api.ui.PageHeader` at the top, content in `px-8`.
- **Panels:** `aside` with `border-l bg-background`, a header row `h-11 border-b px-3`, and content in `px-4`.
- There are four themes: **Light**, **Light (soft)**, **Dark** and **Dark (soft)**: the `.dark` class on `<html>` for dark, plus `.soft` for the soft ones (less contrast). The theme colors above follow all four by themselves; fixed colors (`bg-white`, `#111`) look wrong in at least one. The `dark:` variant works, but you rarely need it.

## Icon

The icon is `icon.svg` in the project root. `npm run zip` puts it in the zip. Forgor shows it on the plugin's card and in the store, and `PluginIcon` (`src/icon.tsx`) shows the same file in the sidebar, the tab and the page header. **Only edit `icon.svg`**; everything else follows.

Forgor uses its SVG as a **shape**: it fills the drawn parts with the surrounding text color, so it matches the app's own icons in light and dark mode. The colors in the file don't matter. Only what's drawn and what isn't counts. That's why it must be a single-color line icon.

Forgor's icons are [Lucide](https://lucide.dev) icons. Make yours look like one of them:

- **Grid:** `viewBox="0 0 24 24"`, `width="24" height="24"`.
- **Strokes, not fills:** `fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` on the `<svg>` (as in the default icon). Small solid dots are fine (a `<circle>` with r 1-2, or a zero-length round line).
- **Keep inside 2-22** on both axes (Lucide's 2px padding), centred by eye. Where a shape needs a corner radius, use 1-2.
- **Simple:** 1-4 shapes. It must read at 16 px, the size it has in the sidebar. No text or letters, no tiny details, no gradients, images, filters, `<style>` or CSS classes, and no transforms if you can avoid them.
- **Meaning:** a familiar object or metaphor for what the plugin does (a calendar, a quote mark, a board…), not an abstract logo.
- **Size:** keep the file small (under a few KB; the store's limit is 128 KB).

How to make one:

1. **If a Lucide icon fits, use it.** Search lucide.dev, open the icon and copy its SVG. Keep the attributes above, and note "<name> from Lucide (ISC license)" in a comment, as the default icon does.
2. **Otherwise draw one** with paths on that grid. Combining or tweaking Lucide shapes is a good way to stay in style.
3. **Check it:** open `icon.svg` in a browser at 16 px and at 64 px. Strokes should be 2 units everywhere, nothing should touch the edge, and it should still be clear at 16 px.

A PNG (`icon.png`, 128×128 or larger, transparent background) also works, but it's shown as is, so it won't adapt to dark mode. Prefer the SVG.

## Style guide

Forgor is calm, compact and neutral: a tool you look at all day. A plugin should feel like part of it, not like a website inside it.

**Look**

- **Neutral surfaces with one accent.** Use the theme colors (see Styling). `primary` is for the one main action on a screen, the selection and focus. Don't make everything colored. Status colors (`destructive`, `success`, `warning`) only mean what they say.
- **Borders over shadows.** Group with a 1px `border` and `bg-muted/40` areas. Small shadows only on things that float (popovers, dialogs) or to lift a card on hover.
- **Small corners** (`rounded`, 4px; `rounded-lg` for cards and tiles). Nothing pill-shaped except switches and badges.
- **Type:** Inter, base 14px.
  - Page titles: `text-xl font-semibold tracking-tight` (PageHeader does it).
  - Body: `text-sm`. List rows: `text-[13px]`. Hints and secondary info: `text-xs text-muted-foreground`.
  - Section labels: `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`.
  - Numbers that change: `tabular-nums`.
- **Icons:** Lucide, `size-4` next to text (`size-3.5` in small buttons, `size-5` in headers), in `text-muted-foreground` unless they're the point.
- **Density:** rows `h-7`/`h-8` with `px-2`, gaps `gap-1.5`-`gap-3`, sections `mb-6`-`mb-8`. Prefer lists and compact cards over big hero areas.

**Layout**

- **Pages:** `mx-auto max-w-3xl pb-16` (lists) or `max-w-5xl` (grids), `api.ui.PageHeader` on top with the actions on its right, and content in `px-8`.
- **Grids:** `grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3`, or 1/2/3 columns with container queries (`@container` on the page, `@xl:grid-cols-2 @4xl:grid-cols-3`).
- **Panels and settings** are narrow (~400px): stack things vertically, full-width inputs, and `api.ui.Setting` for each setting.
- **Works small:** the window can be narrow and the sidebar and panel take space. Truncate long names (`truncate`, `min-w-0` on flex children), and make sure nothing scrolls sideways.

**Behaviour**

- **Use the app's components** (`api.ui.Button`, `Input`, `Switch`, `Select`, `Dialog`, `Tooltip`…) before making your own.
- **Every icon-only button has an `aria-label` and a `Tooltip`.** Clickable rows react to hover (`hover:bg-muted`). Selection uses `bg-accent text-accent-foreground`. Make keyboard work for anything clickable (Enter).
- **States:**
  - *Empty:* a short sentence that says what to do, in a `border border-dashed` box.
  - *Loading:* a small `Loader2` spinning, with "Loading…".
  - *Errors:* say what failed and what to do next, in `text-destructive` or `api.ui.showError`.
- **Destructive actions** ask first (`api.ui.confirmDialog` with `destructive: true`). Prefer reversible actions (the app has a Trash).
- **Motion is minimal:** `transition-colors`, short (150-200 ms). No bouncing, no long animations.
- **Respect the user's data:** don't change notes or todos without them asking, and show what you're about to do.

**Words**

- **Plain, short, sentence case:** "Create folder", not "Create Folder". No exclamation marks or emoji in the UI.
- **Buttons say what happens:** "Install", "Publish v1.2.0", "Download models (5.3 GB)". Not "OK", "Submit" or "Yes".
- **Hints explain why or what next,** in one sentence. Error messages say what went wrong and how to fix it ("Couldn't reach the store. Check your internet connection.").
- **Name things the way the app does:** notes, folders, todos, the sidebar, a note's panel.

## Recipe: data from a web service

How Forgor's own Jira and Bitbucket plugins work, for a service of your own (its API has to allow CORS: see "What the page allows"):

```tsx
let api: PluginApi;

interface Item { id: string; title: string; needsMe: boolean }

// One query, used by the page, the sidebar count and the notification check: one cache, one request.
const itemsQuery = {
  queryKey: ["%%ID%%", "items"],
  queryFn: async (): Promise<Item[]> => {
    const r = await fetch("https://api.example.com/items");
    if (!r.ok) throw new Error(`The service answered ${r.status}. Try again later.`);
    return r.json();
  },
  staleTime: 60_000,
};
const useItems = () => api.app.useQuery({ ...itemsQuery, refetchInterval: 5 * 60_000, refetchOnWindowFocus: true });

function SidebarItem() {
  const { data } = useItems();
  return <api.ui.NavItem icon={PluginIcon} label="Items" count={data?.filter((i) => i.needsMe).length} target={{ kind: "plugin", plugin: api.id, page: "main" }} />;
}

export default (pluginApi: PluginApi): PluginDefinition => {
  api = pluginApi;
  return {
    sidebar: SidebarItem,
    remoteQueries: [api.id], // from the internet: don't refetch on every local change
    notifications: [{ kind: "new", label: "New items", hint: "When an item that needs you shows up." }],
    start: () =>
      api.notifications.poll(async () => {
        const items = await api.app.queryClient.fetchQuery(itemsQuery);
        await api.notifications.notifyNew(
          "new",
          items.filter((i) => i.needsMe).map((i) => ({ id: i.id, title: "Needs you", body: i.title, open: { page: "main", panel: "item", panelParam: i.id } })),
        );
      }),
    // pages: { main: … }, panels: { item: … }
  };
};
```

- **Ask for little.** Services limit requests per hour. Share one query between the page, the count and the check (as above), refresh every few minutes, not seconds.
- **Secrets:** `api.storage` is plain JSON in Forgor's database, not a keychain. If the service needs a token, say so in your settings and keep its rights as small as possible (read-only).
- **Errors** from `queryFn` arrive as `error` in `useQuery`: show them on your page with what to do. A failing notification check is only logged (it would otherwise toast every 5 minutes).

## Rules (things that break in Forgor)

- **Never `window.confirm`, `alert` or `prompt`:** they don't work in the macOS app. Use `api.ui.confirmDialog`, and `api.ui.Dialog` for input.
- **Never fail silently:** catch errors from actions and show them with `api.ui.showError(e, "What failed")`.
- **No native `<input type="date">` or `"time"`:** they behave differently on macOS. Use a text input or your own picker.
- **Clean up:** everything `start` sets up (listeners from `api.app.on`, `setInterval`, event listeners) must be undone by the function it returns.
- **No direct writes to the notes folder or the database;** use `api.data`. Don't touch Tauri internals (`window.__TAURI__…`); they're not part of the API and can change.
- **Hooks:** follow React's rules. Components get the app's React, so hooks from `react` work normally.
- Keep the zip under 5 MB (the store's limit).

## Sharing and the store

- **Zip:** `npm run zip` gives a file anyone can install with **Install from zip**.
- **Store:** install the zip in Forgor, open the plugin's panel (Plugins → click it) and choose **Publish to store**. It's live for everyone right away.
  - The first publish gives a **publish key**. It's saved in that computer's keychain; keep a copy. Without it nobody can publish new versions of this id.
  - **New version:** raise `version` in manifest.json, `npm run zip`, **Update from zip** in the panel, then **Publish vX** there. Users get "Update to vX" on the plugin's card.
- Users see a warning before installing a plugin without the check mark (only Forgor's own and plugins it has checked have one), saying it can read and change their notes. The author name doesn't prove anything to them, so say what the plugin does clearly in `description`.
- Plugins can be reported. Harmful ones are taken out of the store and turned off where they're installed.

## Checklist before handing it out

- `npm run typecheck` passes, and `npm run zip` gives a zip.
- The plugin installs, turns on and off cleanly (nothing left behind when off), and still works after Forgor restarts.
- It looks right in all four themes (Settings → Theme: Light, Light (soft), Dark, Dark (soft)).
- Notifications: the first check after installing doesn't notify about what's already there, nothing notifies twice, and a click in the history (the bell) opens the right place.
- `version` is raised since the last one you shared.
