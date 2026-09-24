# Forgor

*Because you will forgor.* A desktop app (Windows + macOS) for work todos and notes.

- **Notes** are plain `.md` files in a folder you choose. Every folder is a project.
- **Todos** have due date and time, start date, priority, status, subtasks, checklist, recurrence and estimate.
- Todos and notes link **many-to-many**. Type `- [ ] something` in a note and it becomes a real todo.
- **Views:** Inbox, Today, Upcoming, Calendar (month/week, drag to reschedule), folder/project pages, Search (full text + filters), Archive, Trash.
- **Version history** for notes, with a diff and restore.
- **Global shortcut** (`Ctrl+Alt+Space` on Windows, `Cmd+Shift+Space` on macOS) opens a quick menu: New note / New todo / Search. It works even when the app is hidden in the tray.

Everything is local: notes in your folder, todos and the search index in a SQLite database in the app-data folder. Your data is never sent anywhere. The only network request is the update check against GitHub.

## Using it

| Where | How |
| --- | --- |
| Explorer | Right-click for new note/folder/todo, rename, reveal in Explorer/Finder, trash. Drag to move. Click a folder to open its project page. |
| Notes editor | `/` for blocks (headings, tables, code, images…). `[[` links a note (autocomplete; Ctrl/⌘+click to open). `- [ ] text` creates a linked todo. Paste or drop images/files to attach them (saved in `_attachments/` next to the note). |
| Todos | Click a todo to open its detail panel. The 📄 count shows linked notes (hover for titles). |
| Shortcuts | `Ctrl/⌘+K` search · `Ctrl/⌘+Shift+A` new todo · `Alt+←` back · `Esc` close panel |
| Closing | Closing the window hides it to the tray/menu bar so the global shortcut keeps working. Quit from the tray icon menu. |

Completed todos move to the Archive after 7 days (configurable in Settings).

**Updates:** Forgor checks GitHub for a new version shortly after it starts and every 6 hours. When there is one, an "Update to x.y.z" button appears in the sidebar. Nothing is installed until you click **Install update** (Settings → Updates). Your notes and todos are untouched by updates.

**Notes and other editors:** you can edit the `.md` files in VS Code or anywhere else, and the app picks up changes automatically. A `- [ ]` line only becomes a linked todo once the note is edited in the app. Each file gets a small frontmatter block (`id`, `created`) so links survive renames.

## Development

Requirements: Node 22+, Rust (stable), and on Windows the Visual Studio C++ Build Tools. See [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev     # desktop app with hot reload
npm run dev           # browser-only version (in-memory demo data, no files)
```

| Command | What it does |
| --- | --- |
| `npm test` | Unit + integration tests (Vitest; data layer against real SQLite via sql.js) |
| `npm run e2e` | End-to-end UI tests (Playwright, browser build) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run tauri build` | Build installers for the current OS into `src-tauri/target/release/bundle/` |

The npm scripts call Node entry files directly (`node node_modules/...`) because the `&` in this folder's name breaks Windows `.cmd` shims. For the same reason the `.msi` bundler (WiX) fails locally, so build the NSIS installer with `npm run tauri build -- --bundles nsis`. CI builds in a normal path and produces both.

### Releases and updates (Windows + macOS)

```bash
npm run release 0.2.0
```

This bumps the version in `package.json`, `tauri.conf.json` and `Cargo.toml`, commits, tags `v0.2.0` and pushes. The **Release** workflow then:

1. creates a draft GitHub release,
2. builds and signs the Windows installer and a universal macOS `.dmg` into it,
3. publishes the release together with `latest.json`, the file installed apps check.

About 15 minutes later every installed copy shows "Update to 0.2.0".

One-time setup:
- The repo must be **public**, because the updater downloads `releases/latest/download/latest.json` without logging in.
- Add the repository secret **`TAURI_SIGNING_PRIVATE_KEY`** (GitHub → Settings → Secrets and variables → Actions) with the contents of `~/.tauri/forgor.key`.

**Back up `~/.tauri/forgor.key`**, and never commit it. Installed apps only accept updates signed with this key (its public half is in `tauri.conf.json`). If it's lost, existing installs can no longer update themselves: you'd generate a new key, and everyone reinstalls manually once.

The macOS app is unsigned: right-click → Open the first time.

### Architecture

```
src/
  platform/   SqlDriver + VaultFs interfaces; Tauri (real disk + SQLite) and memory (sql.js) implementations
  data/       services on top of the platform: notes/folders indexer, todos, search, trash, versions
  lib/        pure logic (dates, recurrence, frontmatter, inline todos, wiki links, paths), unit tested
  features/   UI: explorer, editor (Milkdown), todos, calendar, search, history, settings, folder
  popup/      the global-shortcut quick menu (separate window)
  app/        boot, store (Zustand), queries (TanStack Query), shell, sidebar
src-tauri/    Rust: plugins, tray, window behaviour, global shortcut
```

The UI never talks to Tauri or the disk directly, only to `src/data`, which only uses the two platform interfaces. Adding cloud sync later (e.g. Supabase) means adding another platform implementation.
