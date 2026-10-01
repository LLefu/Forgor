# Forgor: notes for Claude

Tauri 2 desktop app (Windows + macOS), React 19 + TypeScript + Vite, Tailwind v4. See README for features and architecture.

## Commands
- `npm test`: Vitest (unit + data-layer integration against sql.js). `npm run e2e`: Playwright against the browser build (port 1430).
- `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run tauri dev` / `npm run tauri build`: needs cargo on PATH (`/c/Users/tommy/.cargo/bin` in Git Bash on Windows, `~/.cargo/bin` on macOS via `. ~/.cargo/env`).
- `npm run tauri dev` merges `src-tauri/tauri.dev.conf.json` (via `scripts/tauri.mjs`): identifier `com.llefu.forgor.dev`, so dev has its own database/settings, runs next to an installed Forgor, and starts on `dev-vault/` in the repo (gitignored; `__DEV_VAULT__` in vite.config.ts, only set by `vite serve`).

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
- No native `<input type=date|time>`: they behave differently on macOS (no outside-click close, broken time picker). Use `DatePicker` / `TimePicker` from `components/DateTimePickers.tsx`.
- Folder colors: `folders.color` (schema v3); `lib/folderColors.ts#effectiveFolderColor` inherits from ancestors. Show folders with `FolderLabel` / `FolderSelect` (`features/folder/folderColors.tsx`) so the color appears everywhere. Custom controls inside Radix menus must be menu items (`ContextMenuItemRaw asChild`), otherwise the menu never closes and blocks the page.
- Never use window.confirm/alert/prompt (unsupported in the macOS webview; lint forbids them). Use `confirmDialog()` from `components/ConfirmDialog.tsx`.
- Explorer: the tree is sized to its rows; the space below and the "Notes" header are native drop zones (`features/explorer/move.ts`) that move items to the top level.
- Checklists were merged into subtasks (schema v2 migrates old rows).
- Only the main window runs migrations; the popup calls `waitForSchema` (both migrating at once caused "duplicate column name").
- Tabs live in the UI store (`app/store.ts`, persisted in localStorage): notes get a tab each, pages share one; `setView` reuses an existing tab. Folders are not a view: `openFolder()` shows `FolderPanel` on the right. The todo and folder panels are exclusive (`openTodo` clears the folder and vice versa). All tabs can be closed (`view` is null → `NothingOpen`). Use `noteLinkProps()` (`app/noteLink.ts`) for anything that opens a note, so middle-click works.
- "@" links are markdown links with id URLs: `[Title](forgor://note|embed|todo|folder/<id>)` (`lib/mentions.ts`). Renames rewrite the link text in all notes (`renameMentionsEverywhere`, `renameNote`); backlinks store them as `id:<noteId>`. Milkdown strips unknown schemes from the DOM href, so the editor reads the mark attrs (`features/editor/linkPlugins.ts`), not `a.href`.
- `scripts/patch-crepe.mjs` (postinstall) patches Milkdown's built files: slash-menu `keywords` (so `/h1` works) and image blocks without a title (caption null crashed the note). It fails loudly if a target is gone. After changing it, delete `node_modules/.vite` (Vite caches the pre-bundled copy).
- `[[wiki links]]` were removed on purpose (not standard markdown); "@" links replace them.
- Popovers inside a `DialogContent` portal into the dialog (`PortalContainerContext`): Radix Dialog blocks wheel events outside itself.
- The main window has native decorations: no `data-tauri-drag-region` (it needs a permission and errors on click).
- Video/audio: a `[name.mp4](_attachments/… "width=480")` link alone in its paragraph gets our React player (`MediaPlayer.tsx`, mounted by `mediaWidget.tsx`); the width lives in the link title. Attachments trash as kind `file`.
- Images resize from the corner via `features/editor/imageResize.ts`, which intercepts Crepe's handle and writes the same `ratio` attr Crepe uses.
- Crepe's reset CSS (`.milkdown *`, `.milkdown button`) is unlayered and beats Tailwind utilities inside the editor; React widgets need the `revert-layer` rule in `editor.css`.
- Colors: presets or custom `#rrggbb` (`settings.customColors`); every picker uses `SwatchGrid` from `components/ColorPicker.tsx`.
- react-arborist `tree.get()` only finds visible rows; call `openParents(id)` first (reveal, rename).
- react-arborist rows get `min-width: max-content`; the explorer overrides it (`rowClassName="!min-w-0"`) or long names add scrollbars. The tree height is counted from `tree.isOpen` (`countVisibleRows`), since `visibleNodes` lags until the tree re-renders.
- FullCalendar is pinned to 6.1.x (the v7 React wrapper doesn't match the v6 plugins).

## Meeting recordings
- Rust in `src-tauri/src/meetings/`: `recorder.rs` (cpal: mic + system loopback, 16 kHz WAVs flushed every 5 s), `process.rs` (Silero VAD + Parakeet v3 via sherpa-onnx, echo filter, `detect_language`, Gemma 4 via llama-cpp-2), `models.rs` (pinned HF revisions, sha256-checked downloads to `<app data>/models`), `mod.rs` (commands, tray/dock indicators). Recordings live in `<app data>/recordings/<id>/` until the note is written.
- llama.cpp's built-in chat templates don't know Gemma 4: `gemma_prompt()` writes its format by hand. Changing the summary model means changing that too.
- JS side: `platform/meetings.ts` (Tauri + an in-memory fake for the browser build/e2e), `data/meetings.ts` (table `meetings`, schema v4), `app/meetings.ts` (runtime store, processing queue, startup recovery), `lib/meetingNote.ts` (note markdown).
- Unassigned recordings are notes in `.meetings/` (`MEETINGS_DIR`): the one dot-folder whose `.md` files are indexed (`isIndexedPath`), with no folder row (`ensureFolderRow` skips ignored paths) and hidden from the explorer (`isMeetingsPath` in `buildTree`). `TauriVault.list` must keep walking into it.
- Needs CMake to build (llama.cpp). sherpa-onnx downloads its static libs at build time.
- Real-model tests are `#[ignore]`d: `FORGOR_MODELS=<dir with speech/ summary/> FORGOR_RECORDING=<dir with mic.wav/system.wav> cargo test --release --lib real_models -- --ignored --nocapture`; `recorder::real_devices` records from the actual devices.
- Transcription choices are measured, not guessed (WER against human Dutch subtitles of podcasts/talk shows/interviews, clean and AAC-16 kbit "call" versions; the clips and tools lived in a scratch dir, not the repo). Segments ≥3 s are recognized alone; shorter ones get the preceding ~6 s of the same track as context and keep only their own words (`SHORT_SEGMENT`, `CONTEXT_SAMPLES`, `split_by_time`): 12.2% WER vs 13.5% (all alone) / 13.7% (all joined), 15.5% vs 19.0% / 18.5% on call audio. Joining long segments made Parakeet skip parts of sentences; alone, short Dutch replies came out English. Whisper turbo (forced nl) was no better and 6× slower; Qwen3-ASR 0.6B clearly worse; Core ML 3× slower than CPU for these int8 models.
- Echo: mic frames are cut out before recognition where the mic's loudness follows the system track (`echo_frames`, `cut_out`, threshold 0.6 swept on two real calls), then whole segments are still checked (`echo_correlation`, `is_echo`). The recorder fills gaps with silence by the clock (`gap_to_fill`): macOS delivers no system audio at all while nothing plays.
- Summary prompt has Samenvatting / Belangrijkste punten / Besluiten / Actiepunten; scored with fact checklists (`summary_eval` test). The Google/Unsloth QAT variants of Gemma 4 E4B scored the same as the current Q4_0. Meetings over ~24k tokens (~2 h) are summarized in parts; that path keeps decisions but can drop some action items.
- `FORGOR_DEBUG_TIME=1` / `FORGOR_DEBUG_ECHO=1` print processing stage times / per-segment echo scores.
- Speaker separation (optional model "speakers": pyannote segmentation + CAM++) runs on the system track (on the mic when the system track has no speech, i.e. in person); VAD segments are cut at speaker changes (`split_at_speakers`). Clustering threshold 0.9 (the default 0.5 gave ~80 speakers on one standup).
- Voices: `voice_prints` → `ProcessResult.voices`; named voices live in `voice_samples` (schema v6, one row per meeting+speaker, averaged per name, `data/voices.ts`) and are matched before summarizing (`match_voices`, `RECOGNIZE` 0.6 / `SUGGEST` 0.5, calibrated on a real standup). The summary model sees "Opnemer"/"Deelnemer"/names, never "Ik"/"Anderen" (Dutch "ik" made it give the others' tasks to the user).
- The dev app keeps recording audio (`KEEP_AUDIO`) and also writes `*.raw.wav` at the device rate; "Transcribe again" exists only there.
- In dev (unbundled binary) macOS attributes mic permission to the terminal/editor; without it the mic track is silent (zeros, no error). `src-tauri/Info.plist` has the usage strings for the bundled app.

## Debugging the real desktop window
Launch with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and connect Playwright via `chromium.connectOverCDP("http://localhost:9222")`.

## Updates / releases
- Updater: `tauri-plugin-updater` against `https://github.com/LLefu/Forgor/releases/latest/download/latest.json`; pubkey in `tauri.conf.json`. The private key lives at `~/.tauri/forgor.key` (never in the repo) and in the GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.
- UI state is in `src/app/updates.ts` (background check 5s after start, then every 6h; installing always needs a user click). Tauri calls are in `src/platform/updates.ts`.
- CHANGELOG.md is the single source for the in-app version history, GitHub release notes and latest.json notes. Add entries under `## Unreleased`; `npm run release` renames it and refuses to run when it is empty.
- Release: `npm run release X.Y.Z` → tag → `.github/workflows/release.yml` (draft → build both OSes → publish).
- Local signed build: set `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/forgor.key)"` (the `_PATH` variant is not picked up). To test updates locally, pass `--config` with a localhost endpoint + `dangerousInsecureTransportProtocol: true`. Never ship that build.
