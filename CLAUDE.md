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
- Inline todos: `- [ ] text ^t-<id>` in markdown. The editor appends markers (hidden via decoration) after a typing pause; `saveNote` in `data/noteSave.ts` syncs note → todos, and `todos.ts` pushes checkbox/title changes back into the file.
- Milkdown serializes empty paragraphs as `<br />`; `lib/markdown.ts#cleanMarkdown` strips them before saving.
- Browser mode (`npm run dev`) seeds demo data; `?empty` starts blank. `window.__wn` exposes `{ vault, sql }` there for tests.
- FullCalendar is pinned to 6.1.x (the v7 React wrapper doesn't match the v6 plugins).

## Debugging the real desktop window
Launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and connect Playwright via `chromium.connectOverCDP("http://localhost:9222")`.

## Updates / releases
- Updater: `tauri-plugin-updater` against `https://github.com/LLefu/Forgor/releases/latest/download/latest.json`; pubkey in `tauri.conf.json`. The private key lives at `~/.tauri/forgor.key` (never in the repo) and in the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.
- UI state is in `src/app/updates.ts` (background check 5s after start, then every 6h; installing always needs a user click). Tauri calls are in `src/platform/updates.ts`.
- Release: `npm run release X.Y.Z` → tag → `.github/workflows/release.yml` (draft → build both OSes → publish).
- Local signed build: set `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/forgor.key)"` (the `_PATH` variant is not picked up). To test updates locally, pass `--config` with a localhost endpoint + `dangerousInsecureTransportProtocol: true`. Never ship that build.
