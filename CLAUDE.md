# Forgor: notes for Claude

Tauri 2 desktop app (Windows + macOS), React 19 + TypeScript + Vite, Tailwind v4. See README for features and architecture.

## Commands
- `npm test`: Vitest (unit + data-layer integration against sql.js). `npm run e2e`: Playwright against the browser build (port 1430).
- `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run tauri dev` / `npm run tauri build`: needs cargo on PATH (`/c/Users/tommy/.cargo/bin` in Git Bash).

## Gotchas
- The folder name contains `&`, which breaks Windows `.cmd` shims (`npx`, `node_modules/.bin`). npm scripts call `node node_modules/<pkg>/<entry>` directly; do the same for new tools.
- Full-text search uses **FTS4**, not FTS5 (sql.js has no FTS5).
- `src/platform` holds the only code that may touch Tauri APIs. Import `isTauri` from `platform/env.ts` and load Tauri modules dynamically so the browser build works.
- The global shortcut is registered in Rust (`set_hotkey` command in `src-tauri/src/lib.rs`), not JS, so it survives webview reloads.
- Inline todos: `- [ ] text ^t-<id>` in markdown. **Only the editor assigns markers** (`assignMarkersInView`, after a typing pause, then it calls onChange itself because Milkdown does not report non-history transactions). `saveNote` only syncs lines that already have a marker; assigning there too raced the editor and duplicated todos. Pass `{ assignIds: true }` only when there is no editor (demo seed).
- NoteView compares saved vs. on-disk bodies with `sameContent` (ignores leading blank lines); a strict compare reloaded the editor mid-typing.
- Milkdown serializes empty paragraphs as `<br />`; `lib/markdown.ts#cleanMarkdown` strips them before saving.
- Browser mode (`npm run dev`) seeds demo data; `?empty` starts blank. `window.__wn` exposes `{ vault, sql }` there for tests.
- Drag & drop: react-arborist is given `dndRootElement` (the explorer box). Its default root is the window, where react-dnd preventDefault()s every drop and silently broke Milkdown block dragging. Tauri windows set `dragDropEnabled: false` (Windows otherwise swallows HTML5 drags).
- Tauri fs scope: `plugins.fs.requireLiteralLeadingDot` is `false` in tauri.conf.json. It defaults to true on macOS/Linux, where `**` then does not match dot-folders like `.trash` (trash failed on macOS only). `src/lib/config.test.ts` guards this and `dragDropEnabled`.
- Unhandled promise rejections show an error toast (`components/Toasts.tsx`, `showError()`); failures must never be silent.
- Date/time inputs: `lib/pickers.ts` prevents segment focus on mouse click and calls `showPicker()`; the segment highlight cannot be removed with CSS. `DateField` only saves complete dates (typing saved years like 0002).
- Never use window.confirm/alert/prompt (unsupported in the macOS webview; lint forbids them). Use `confirmDialog()` from `components/ConfirmDialog.tsx`.
- Explorer: the tree is sized to its rows; the space below and the "Notes" header are native drop zones (`features/explorer/move.ts`) that move items to the top level.
- Checklists were merged into subtasks (schema v2 migrates old rows).
- FullCalendar is pinned to 6.1.x (the v7 React wrapper doesn't match the v6 plugins).

## Debugging the real desktop window
Launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and connect Playwright via `chromium.connectOverCDP("http://localhost:9222")`.

## Updates / releases
- Updater: `tauri-plugin-updater` against `https://github.com/LLefu/Forgor/releases/latest/download/latest.json`; pubkey in `tauri.conf.json`. The private key lives at `~/.tauri/forgor.key` (never in the repo) and in the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.
- UI state is in `src/app/updates.ts` (background check 5s after start, then every 6h; installing always needs a user click). Tauri calls are in `src/platform/updates.ts`.
- CHANGELOG.md is the single source for the in-app version history, GitHub release notes and latest.json notes. Add entries under `## Unreleased`; `npm run release` renames it and refuses to run when it is empty.
- Release: `npm run release X.Y.Z` → tag → `.github/workflows/release.yml` (draft → build both OSes → publish).
- Local signed build: set `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/forgor.key)"` (the `_PATH` variant is not picked up). To test updates locally, pass `--config` with a localhost endpoint + `dangerousInsecureTransportProtocol: true`. Never ship that build.
