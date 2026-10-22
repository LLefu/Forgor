# Writing a Forgor plugin

A plugin adds things to Forgor: sidebar items, pages, panels, a section in a folder's panel, buttons in a note's top bar, settings, background work. It runs inside the app with the same access as the app itself: notes, todos, settings and the UI, but (like the app) nothing outside the notes folder and Forgor's plugin files. Users see a warning before installing one that Forgor hasn't checked.

**The quickest start:** Plugins → **Create plugin project** in Forgor. It writes a folder with a working example, the build, `npm run zip`, and an `AGENTS.md` that explains the whole API (so an AI assistant can help). The template is in [`src/features/plugins/template`](../../src/features/plugins/template); `node scripts/plugin-template.mjs` builds a project from it as a check (part of `npm run e2e`).

The types (`index.d.ts`) are self-contained: they only need React's types, so they work outside this repo (the template copies them into the project). `src/plugins/publicApi.check.ts` makes `npm run typecheck` fail when the app stops matching them. When you change what plugins get, update `index.d.ts`, and the template's `AGENTS.md` too.

## What a plugin is

A folder with:

| File | |
|---|---|
| `manifest.json` | `id` (lowercase letters, digits, dashes), `name`, `version`, `author`, `description`; optional `minAppVersion`, `requires` (other plugin ids), `models` (AI models it uses) |
| `main.js` | One **CommonJS** bundle: `module.exports = (api) => ({ …contributions })` |
| `styles.css` | Optional. Applied while the plugin is enabled |
| `icon.svg` / `icon.png` | Optional. An SVG is drawn as a shape in the theme's text color (like the app's own Lucide icons), so make it a single-color line icon: 24×24, stroke 2, round caps. A PNG is shown as it is. Or return an `icon` component from main.js |

Zip these files (at the top of the zip, or in one folder inside it) and install it with **Plugins → Install from zip**. Installed plugins live in `<app data>/plugins/<id>/`. Installing a newer version replaces the old one. Uninstalling removes the files but keeps what the plugin stored.

## main.js

```tsx
import type { PluginFactory } from "@forgor/plugin-api";
import { LayoutGrid } from "lucide-react";

const plugin: PluginFactory = (api) => ({
  icon: LayoutGrid,
  sidebar: () => <api.ui.NavItem icon={LayoutGrid} label="Hello" target={{ kind: "plugin", plugin: api.id, page: "main" }} />,
  pages: {
    main: {
      useTab: () => ({ label: "Hello", icon: LayoutGrid }),
      component: () => <api.ui.PageHeader title="Hello from a plugin" />,
    },
  },
  start: () => api.app.on("folder-open", (id) => console.log("opened folder", id)), // returns how to stop
  settings: () => <api.ui.Setting label="Nothing to set yet" />,
});

export default plugin;
```

All contribution points are in [`src/plugins/types.ts`](../../src/plugins/types.ts): `sidebar`, `pages`, `panels`, `folderSection`, `noteHeader`, `settings`, `hosts`, `start`, `useWriter`, `useQuickMenu`, `remoteQueries`, `disableBlocked`. The app only shows a plugin's contributions while it is enabled. Errors inside them are caught and shown, and don't take the app down.

## The API (`api`)

See [`src/plugins/api.ts`](../../src/plugins/api.ts) for everything. In short:

- `api.app`: `openPage(page, param)`, `openNote`, `openFolder`, `openTodo`, `openSettings`, `on("folder-open", cb)`, the UI store (`useUI`), data hooks (`useFolders`, `useNotes`, `useTodos`), and `useQuery` / `queryClient.fetchQuery` on the app's own TanStack client (one cache for a plugin's page, sidebar count and background checks; list remote keys in `remoteQueries`). The template's AGENTS.md has a recipe for a web service with a count and notifications.
- `api.data`: the app's data layer. `notes` covers notes and folders (`createNote`, `createFolder`, `renameNote`, `moveNote`…), plus `todos`. Changes refresh the app by themselves.
- `api.storage`: small data for your plugin, stored on this computer (not in the notes folder). Use `get`, `set`, and `useValue(key, fallback)` as React state.
- `api.notifications`: desktop notifications for the kinds the plugin declares in `notifications` (a switch each in its panel): `poll(check)` in `start`, `notifyNew(kind, items)` notifies only about ids not seen before (the first call only takes stock), `notify(kind, n)` for one right away. Every notification also lands in the history (the bell next to Settings); give items an `open` (a page and/or panel of the plugin) so a click there opens what it's about.
- `api.ui`: the app's components (`Button`, `Input`, `Switch`, `Select`, `Dialog`, `DialogContent`, `Tooltip`, `NavItem`, `Setting`, `PageHeader`, `Section`, `FolderGlyph`, `FolderLabel`), plus `confirmDialog`, `showError`, `noteLinkProps` and `cn`.
- `api.lib` / `api.platform`: path helpers, folder colors, `isTauri`, `openExternal`.

## Building

- **React comes from the app.** Keep `react`, `react/jsx-runtime` and `react-dom` external; a second copy of React breaks hooks. Bundle everything else (icons, libraries).
- **Output must be CommonJS.** `require` only resolves those three modules.
- **CSS:** the app's CSS doesn't include your classes. Build your own `styles.css`, without a reset, against the app's theme, so `bg-background`, `text-muted-foreground`, `border` and the rest follow light/dark mode and the highlight color:

  ```css
  @import "tailwindcss/theme" theme(reference);
  @import "../forgor/theme.css"; /* a copy of packages/plugin-api/theme.css */
  @import "tailwindcss/utilities" source("./");
  ```

The template's `vite.config.ts`, `tsconfig.json` and `scripts/zip.mjs` (in [`src/features/plugins/template/files`](../../src/features/plugins/template/files)) do all of this; start from a generated project rather than writing them yourself.

- **What the page allows:** Forgor's content security policy and file permissions apply to plugins too. No scripts, stylesheets or web fonts from other sites (bundle them), `fetch`/WebSockets over https/wss and to localhost only, iframes with https pages only, and no file system (use `api.data` and `api.storage`). The template's `AGENTS.md` has the details; the policy itself is `app.security.csp` in `src-tauri/tauri.conf.json`.

### Sharing

From a plugin's panel (Plugins → Installed → click it):

- **Export as zip**: a file you can send someone. They use **Install from zip**.
- **Publish to store**: anyone can install it from Plugins → Store right away. The first publish of an id gives a **publish key**. It's kept in your keychain, and you need it to publish new versions, so keep a copy. A new version needs a higher `version` in manifest.json. Plugins that are harmful are taken out of the store and turned off where they're installed. Installing one without the check mark (`verified`, set by Forgor's maintainer) shows a warning first.
