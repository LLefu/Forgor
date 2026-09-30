# Changelog

All notable changes to Forgor. Add new entries under **Unreleased**;
`npm run release X.Y.Z` turns that section into the new version.

## Unreleased

### New
- **Zoom**: Ctrl/⌘ + and Ctrl/⌘ − make the whole app bigger or smaller, like in a browser; Ctrl/⌘ 0 resets it. The level is remembered, and can also be set in Settings → Zoom.

## 0.2.0 (2026-09-29)

### New
- **Tabs**: every note opens in its own tab (Today, Calendar and the other pages share one). Middle-click a note anywhere (explorer, links, search, folder panel) to open it in a tab. Drag tabs to reorder, middle-click or × to close, right-click for the same menu as in the explorer plus Close others / Close all. Ctrl/⌘+W closes a tab, Ctrl+Tab switches. You can close every tab. Open tabs are remembered.
- **@ links**: type @ to link a note, todo or folder; the @ disappears and a link is left. It only starts at the beginning of a word (so e-mail addresses are safe); Esc or a space right after @ dismisses it. Links follow renames and moves. Click a link for Open / Show entire note / Remove link; Ctrl/⌘+click opens it directly. "Show entire note" shows the whole note inline; "Show as link" turns it back. /note does the same as @, for notes only. [[wiki links]] are no longer supported (they show as plain text).
- **/document**: attach any file. It shows as a link; clicking it opens the file in its default app.
- **/video** and **/audio**: attach a video or audio file, with a player in the app's style (play/pause, seek, volume, speed, full screen). Drag a video's corner to resize it; the size is saved. Audio has a vertical volume slider when you hover the speaker.
- Images sit on the left and resize from their bottom-right corner, like videos.
- /document, /image, /video and /audio first show the matching files already in the note's folder, with an "Upload file" button (the file dialog opens straight away when there are none).
- **Find in note** (Ctrl/⌘+F): highlights matches; Enter / Shift+Enter for next / previous.
- **Floating search** (Ctrl/⌘+Shift+F): search notes, folders and todos over whatever is open. Esc or a click outside closes it.
- **Folder details** open in a panel on the right (like a todo) instead of a separate page, with its attachments (open them, or move them to the trash). You can rename the folder there. Only one detail panel (folder or todo) is open at a time; the explorer marks the folder that is open.
- **Reveal in explorer**: the target button above the explorer (also in the note's ⋯ menu and on tabs) expands the tree to the open note.
- **Custom colors**: the + at the end of every color picker opens a color wheel with hex and RGB. Added colors appear in every color picker, including the highlight color.
- Resizable sidebar and right-hand panel: drag their edge; double-click to reset.
- Explorer: Ctrl/⌘+click and Shift+click select several items; Delete moves the selection to the trash (after confirming), Enter opens it (all selected notes in tabs, the topmost folder in the panel), F2 renames; right-click the empty space to create a note, folder or todo at the top level; clicking the empty space closes the detail panel. The New note / New folder / New todo buttons create at the top level unless a folder panel is open.
- Slash-menu shorthands: /h1–/h6, /ul, /ol, /todo, /q, /hr, /code, /img, /tbl and more.

### Improved
- Deleting a todo asks for confirmation first (notes and folders already did).
- The dropdown arrow in the folder picker sits at the far right.
- Search also finds folders.

### Fixed
- The app could fail to start with "duplicate column name: color" after an update.
- Notes with an image on its own line (without a title) could not be opened.
- The folder list in "New todo" couldn't be scrolled with the mouse wheel.

## 0.1.3 (2026-09-29)

### New
- **All tasks** replaces Upcoming: every todo in one list, sorted by due date, priority, folder, newest or title, with an option to show completed ones.
- **Folder colors**: right-click a folder → Color, or use the Color button on its page. Subfolders use their parent's color unless they have their own. The color shows in the explorer, on todos, in folder pickers, breadcrumbs and as a dot on calendar events.
- New date picker (with week numbers and Today / Tomorrow / Next Monday / No date) and time picker (pick from the list or type e.g. "930" or "2pm"). They work the same on Windows and macOS.
- "No date" option when adding a todo.

### Fixed
- The date picker didn't close when clicking outside it (macOS).
- The time picker didn't work (macOS).

### Improved
- Long subtask titles wrap instead of being cut off.

## 0.1.2 (2026-09-25)

### Fixed
- Move to trash still did nothing on macOS: the app wasn't allowed to write to the hidden `.trash` folder there.
- Clicking a date or time field highlights the whole field instead of just the day, month or year part.
- Typing a date with the keyboard in a todo could save a wrong year while you were still typing.

### Improved
- If an action fails, a short error message now appears instead of nothing happening.
- Hidden folders in your notes folder (like `.git` or `.obsidian`) are skipped, which makes syncing faster.

## 0.1.1 (2026-09-24)

### New
- Version history with a changelog per version (Settings → Updates → Version history).
- Back and forward buttons at the top left; the mouse side buttons and Alt+←/→ work too.
- Settings → Highlight color: 14 colors, each with light and dark mode shades.
- Week numbers in the calendar.
- New notes and folders open straight into rename mode; Enter confirms.
- Drag notes and folders onto the "Notes" header or the empty space below the tree to move them to the top level.

### Improved
- Hand cursor on everything clickable.
- Calendar days and time slots highlight on hover.
- The todo circle has its own hover state and is vertically centred.
- Clicking anywhere in a date or time field opens the picker.
- Stronger contrast for icons, bullets, checkboxes and block handles in the editor; the handles also appear when hovering the left margin.
- P2 is now yellow, so it's easy to tell apart from P1.
- Checklists are merged into subtasks. Existing checklist items became subtasks.
- Clicking a folder name opens its overview without collapsing it; use the arrow or folder icon to expand/collapse.
- Native date pickers and dropdowns follow dark mode.

### Fixed
- Move to trash (and other confirmations) did nothing on macOS.
- Typing a task list could create duplicate todos and an empty "<br />" todo.
- The cursor could jump to the top of a note while typing.
- Dragging blocks in the editor and dragging files in the explorer didn't work.
- Right-click → Rename closed immediately.

## 0.1.0 (2026-09-24)

### New
- First release of Forgor: markdown notes in real folders, todos with dates, priorities, subtasks and recurrence, linked many-to-many with notes.
- Today, Upcoming, Inbox, calendar, search, archive, trash and note version history.
- Global shortcut quick menu (Ctrl+Alt+Space / Cmd+Shift+Space).
- In-app updates.
