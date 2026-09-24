# Changelog

All notable changes to Forgor. Add new entries under **Unreleased**;
`npm run release X.Y.Z` turns that section into the new version.

## Unreleased

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
