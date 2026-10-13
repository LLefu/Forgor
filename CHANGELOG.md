# Changelog

All notable changes to Forgor. Add new entries under **Unreleased**;
`npm run release X.Y.Z` turns that section into the new version.

## Unreleased

### New
- A folder can link **more than one Jira board** (Add board in the folder's panel). The folder shows your tickets from all of them together, and View all opens them on one page. Each board can be unlinked on its own.
- In the **Jira** overview, tickets from a board that's linked to a folder with an icon show that icon, so you can tell the projects apart at a glance.

### Fixed
- Linking another Jira board to a folder closed the board list right away, so no board could be picked.
- The board search only found boards by their own name and only looked at the first 50. It now searches all your boards, by board name, project name or key (a project's board is often called something like "Sprint board"). × or Esc closes it.

## 0.5.0 (2026-10-13)

### New
- **Jira** (turn on in Settings → Jira): connect your Jira Cloud account with your email and an API token (stored in your computer's keychain). Link a Jira board to a folder in its panel, and the tickets assigned to you on that board show below the notes, with **View all** for the full list. **Jira** in the sidebar lists every ticket assigned to you, with search, filters (status, project, priority) and sorting. Click a ticket to see its details, description and comments on the right, or open it in Jira. Read-only: Forgor never changes anything in Jira.

- **Folder icons**: upload any image as a folder's icon (Icon in the folder's panel, or right-click → Icon in the explorer). It replaces the folder symbol everywhere the folder appears; remove it the same way.

### Removed
- The **Calendar** view. Due dates, times and repeating todos are unchanged and still show under Today and All tasks.

## 0.4.0 (2026-10-12)

### New
- **Writing tools** (turn on in Settings → Writing tools): select text and click the ✨ button in the toolbar, or use **AI** above a note for the whole note, and type what you want: shorter, more formal, fix the spelling, translate, turn it into a list… The answer appears in the note as a change to review (Accept all / Reject all / Retry; ⌘/Ctrl+Enter accepts, Esc rejects) and nothing is saved until you accept. Runs on your computer with the same model as the meeting summaries. Images, links, files, code and todos are kept out of the AI's reach, you're warned when its version would leave one out, the text from before every request is kept in the version history, and Ctrl/⌘+Z undoes an accepted change.

## 0.3.0 (2026-10-01)

### New
- **Meeting recordings** (turn on in Settings → Meeting recordings): record a meeting and get a transcript and summary (summary, key points, action items) in a note. Records your microphone and everything the computer plays, so the other people in a call are included, and labels who spoke ("Ik"/"Anderen", "Me"/"Others"). Dutch and English are both recognized, also mixed. Everything runs on your computer after a one-time model download (about 5.3 GB), which you can delete again in Settings. Start and stop from **Meetings** in the sidebar, the quick menu or the tray icon, which turns red while recording (the Dock/taskbar icon gets a badge too). After stopping, Forgor asks for a name and folder. Recordings without a folder only show under Meetings; assign one there and the note appears in that folder. The audio is deleted once the note is written; a recording cut off by a crash is processed on the next start.
- **Zoom**: Ctrl/⌘ + and Ctrl/⌘ − make the whole app bigger or smaller, like in a browser; Ctrl/⌘ 0 resets it. The level is remembered, and can also be set in Settings → Zoom.

- **Who said what in meetings**: with the optional speaker separation (34 MB, Settings → Meeting recordings) the other participants become "Spreker 1, 2, 3…" instead of one "Anderen". Name them with the Speakers button (a quote per speaker helps you recognize them); the transcript and summary use the names, and giving two numbers the same name merges them. Named voices are recognized in later meetings; the voice fingerprints stay on your computer and can be forgotten per person under Known voices.
- Meeting summaries have a **Besluiten / Decisions** section, and list every task people say they'll do (also in stand-ups); a request to someone else ("kun jij…") is that person's action item.
- Better meeting transcripts: short replies stay Dutch, fewer skipped words, and the other side's voice (heard through your speakers) is cut out of your own lines.
- While recording, the quick menu and the Meetings page show level meters for your microphone and the computer's sound, and warn when the mic gives no sound at all (muted or no permission), when only the mic can be recorded, and after 10 minutes without any sound (with a notification: "Still recording?").
- **Storage** in Settings: how much Forgor uses and where (notes, attachments, trash, database, models, recordings, cache), with a button to show each in Finder / Explorer.

### Fixed
- The explorer could show scrollbars (and cut off the last item) when a note or folder had a long name. Long names are now shortened with “…”.

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
