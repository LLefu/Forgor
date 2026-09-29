import { expect, test, type Page } from "@playwright/test";

async function readVaultFile(page: Page, suffix: string) {
  return page.evaluate(async (s) => {
    const { vault } = (window as unknown as { __wn: { vault: { list(): Promise<{ path: string }[]>; readText(p: string): Promise<string> } } }).__wn;
    const f = (await vault.list()).find((e) => e.path.endsWith(s));
    return f ? vault.readText(f.path) : null;
  }, suffix);
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function openNote(page: Page, folder: string, note: string) {
  const row = page.getByTestId(`tree-note-${note}`);
  if (!(await row.isVisible())) await page.getByTestId(`tree-folder-${folder}`).getByTestId("tree-toggle").click();
  await row.click();
  await expect(page.getByTestId("note-title")).toHaveValue(note);
}

/** A fresh note in Internal, with the cursor in the (empty) body. */
async function newNote(page: Page, title: string) {
  await page.getByTestId("tree-folder-Internal").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New note" }).click();
  await page.keyboard.press("Escape"); // leave explorer rename mode
  const t = page.getByTestId("note-title");
  await t.fill(title);
  await t.press("Enter");
  await expect(page.getByTestId("tree-note-" + title)).toBeVisible();
}

test("tabs: notes open in tabs, reorder, middle-click and × close, right-click menu", async ({ page }) => {
  await page.goto("/");
  await openNote(page, "Acme migration", "Project plan");
  await openNote(page, "Internal", "1-on-1 notes");
  const tabs = page.getByTestId("tab");
  await expect(tabs).toHaveCount(3); // Today + 2 notes
  await expect(tabs.nth(1)).toHaveAttribute("data-title", "Project plan");
  await expect(tabs.nth(2)).toHaveAttribute("data-title", "1-on-1 notes");

  // Clicking an open note again reuses its tab
  await page.getByTestId("tree-note-Project plan").click();
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

  // Pages share one tab
  await page.getByTestId("nav-calendar").click();
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAttribute("data-title", "Calendar");

  // Drag "1-on-1 notes" before "Project plan"
  await tabs.nth(2).dragTo(tabs.nth(1), { targetPosition: { x: 5, y: 10 } });
  await expect(tabs.nth(1)).toHaveAttribute("data-title", "1-on-1 notes");

  // Right-click shows the explorer menu too
  await tabs.nth(1).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Reveal in explorer" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move to trash" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Middle click closes, × closes
  await tabs.nth(1).click({ button: "middle" });
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).hover();
  await tabs.nth(1).getByTestId("tab-close").click();
  await expect(tabs).toHaveCount(1);

  // Middle click on a note in the explorer opens it in a tab
  await page.getByTestId("tree-note-Project plan").click({ button: "middle" });
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute("data-title", "Project plan");

  // "Close all", and the last tab can be closed too: nothing is open
  await tabs.nth(0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all" }).click();
  await expect(tabs).toHaveCount(0);
  await expect(page.getByTestId("nothing-open")).toBeVisible();
  // Clicking the empty tab bar doesn't error
  await page.getByTestId("tabbar").click({ position: { x: 300, y: 10 } });
  await page.getByTestId("nav-today").click();
  await expect(tabs).toHaveCount(1);
});

test("folder panel on the right, delete confirmations, reveal in explorer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  const panel = page.getByTestId("folder-panel");
  await expect(panel.getByTestId("folder-name")).toHaveValue("Acme migration");
  await expect(panel).toContainText("Review migration script");
  await expect(page.getByTestId("tab")).toHaveCount(1); // the main area is unchanged

  // The explorer marks the folder whose panel is open, also while a note is selected
  await expect(page.getByTestId("tree-folder-Acme migration").getByTestId("panel-marker")).toBeVisible();

  // Only one detail panel at a time: opening a todo replaces the folder panel
  await panel.getByText("Review migration script").click();
  await expect(page.getByTestId("todo-detail")).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Delete todo" }).click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Delete todo?");
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancel" }).click();
  // Clicking empty space in the explorer closes the panel
  await page.getByTestId("explorer-root-drop").click();
  await expect(page.getByTestId("todo-detail")).toHaveCount(0);
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();

  // Folder trash asks first
  await panel.getByTestId("folder-trash").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Move folder to trash?");
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Cancel" }).click();

  // Reveal: collapse everything, then reveal the open note
  await page.getByTestId("tree-folder-Acme migration").getByTestId("tree-toggle").click();
  await openNote(page, "Meetings", "Kickoff 2026-09-22");
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByTestId("tree-note-Kickoff 2026-09-22")).toHaveCount(0);
  await page.getByTestId("reveal-note").click();
  await expect(page.getByTestId("tree-note-Kickoff 2026-09-22")).toBeVisible();

  // Delete key on the selected row asks to trash it
  await page.getByTestId("tree-note-Kickoff 2026-09-22").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("confirm-dialog")).toContainText("Move note to trash?");
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByTestId("tree-note-Kickoff 2026-09-22")).toHaveCount(0);
});

test("explorer empty space: right-click creates at the top level; header buttons use the root unless a folder is open", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-1-on-1 notes").click(); // a note inside a folder is open
  await page.getByTestId("explorer-root-drop").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await page.keyboard.type("Top");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as { __wn: { vault: { exists(p: string): Promise<boolean> } } }).__wn.vault.exists("Top")))).toBe(true);

  await page.getByRole("button", { name: "New note" }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-title")).toHaveValue("Untitled");
  await expect(page.getByTestId("main").getByText("Internal")).toHaveCount(0); // no breadcrumb: top level

  await page.getByTestId("tree-folder-Internal").locator("span.truncate").click();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.keyboard.type("Sub");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as { __wn: { vault: { exists(p: string): Promise<boolean> } } }).__wn.vault.exists("Internal/Sub")))).toBe(true);
});

test("folder dropdown in Add todo scrolls with the mouse wheel", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab")).toHaveCount(1); // booted
  for (let i = 0; i < 14; i++) await page.evaluate((n) => (window as unknown as { __wn: { vault: { mkdir(p: string): Promise<void>; emitChange(): void } } }).__wn.vault.mkdir(`Folder ${n}`), i);
  await page.evaluate(() => (window as unknown as { __wn: { vault: { emitChange(): void } } }).__wn.vault.emitChange());
  await expect(page.getByTestId("tree-folder-Folder 13")).toBeVisible();
  await page.getByRole("button", { name: "Add todo" }).first().click();
  await page.getByTestId("quick-folder").click();
  const list = page.locator(".max-h-72.overflow-y-auto");
  await list.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test("slash shorthands, @ links (sync on rename, embed), find in note", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await newNote(page, "Scratch");

  // "/h1" works as a shorthand for Heading 1
  await page.keyboard.type("/h1", { delay: 40 });
  await expect(page.locator(".milkdown-slash-menu")).toContainText("Heading 1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Title here");
  await expect(page.getByTestId("note-editor").locator("h1")).toHaveText("Title here");
  await page.keyboard.press("Enter");

  // "@" links a note; the "@" disappears
  await page.keyboard.type("See @proj", { delay: 30 });
  await expect(page.getByTestId("mention-suggest")).toContainText("Project plan");
  await page.keyboard.press("Enter");
  const mention = page.getByTestId("note-editor").locator(".mention-note");
  await expect(mention).toHaveText("Project plan");
  // An e-mail address never opens the picker
  await page.keyboard.type(" mail me@work.com", { delay: 20 });
  await expect(page.getByTestId("mention-suggest")).toHaveCount(0);
  await expect.poll(() => readVaultFile(page, "Internal/Scratch.md")).toMatch(/See \[Project plan\]\(forgor:\/\/note\/[A-Za-z0-9_-]+\)/);

  // Renaming the target updates the link text in this note
  await page.getByTestId("tree-folder-Acme migration").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-Project plan").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("explorer").locator("input").fill("Master plan");
  await page.keyboard.press("Enter");
  await expect.poll(() => readVaultFile(page, "Internal/Scratch.md")).toMatch(/\[Master plan\]\(forgor:\/\/note\//);
  await page.getByTestId("tab").filter({ hasText: "Scratch" }).click();
  await expect(page.getByTestId("note-editor").locator(".mention-note")).toHaveText("Master plan");

  // Click → Show entire note → the note is rendered inline; and back to a link
  await page.getByTestId("note-editor").locator(".mention-note").click();
  await page.getByTestId("mention-embed").click();
  const embed = page.getByTestId("note-editor").locator(".note-embed");
  await expect(embed).toContainText("Inventory");
  await expect.poll(() => readVaultFile(page, "Internal/Scratch.md")).toMatch(/\n\[Master plan\]\(forgor:\/\/embed\//);
  await page.getByTestId("note-editor").locator(".note-embed-bar").getByRole("button", { name: "Show as link" }).click();
  await expect(embed).toHaveCount(0);

  // Ctrl/⌘+F finds in the note
  await page.getByTestId("note-editor").locator("h1").click();
  await page.keyboard.press(`${mod}+f`);
  await page.getByTestId("find-input").fill("here");
  await expect(page.getByTestId("find-count")).toHaveText("1/1");
  await expect(page.getByTestId("note-editor").locator(".find-current")).toHaveText("here");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("find-bar")).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("Ctrl/⌘+Shift+F floating search finds notes, folders and todos", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab")).toHaveCount(1); // app booted
  await page.keyboard.press(`${mod}+Shift+f`);
  const overlay = page.getByTestId("search-overlay");
  await expect(overlay.getByTestId("search-input")).toBeFocused();
  await page.keyboard.type("acme");
  await expect(overlay.getByTestId("search-folder-hit").first()).toContainText("Acme migration");
  await expect(overlay).toContainText("Prepare demo for Acme");
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press(`${mod}+Shift+f`);
  await page.keyboard.type("acme");
  await page.getByTestId("search-overlay").getByTestId("search-folder-hit").first().click();
  await expect(page.getByTestId("search-overlay")).toHaveCount(0);
  await expect(page.getByTestId("folder-panel")).toBeVisible();

  // Click outside closes
  await page.keyboard.press(`${mod}+Shift+f`);
  await page.mouse.click(10, 700);
  await expect(page.getByTestId("search-overlay")).toHaveCount(0);
});

test("resizable sidebar and custom colors", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator("aside").first();
  const before = (await sidebar.boundingBox())!.width;
  const handle = page.getByTestId("resize-sidebarWidth");
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 200);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 200, { steps: 5 });
  await page.mouse.up();
  expect((await sidebar.boundingBox())!.width).toBeGreaterThan(before + 100);

  // Add a custom color from the folder color menu; it's offered in Settings too
  await page.getByTestId("tree-folder-Internal").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Color" }).hover();
  await page.getByTestId("add-color").click();
  const dialog = page.getByTestId("add-color-dialog");
  await dialog.getByTestId("hex-input").fill("#123abc");
  await expect(dialog.getByRole("spinbutton", { name: "G" })).toHaveValue("58");
  await dialog.getByTestId("add-color-confirm").click();
  await expect(page.getByTestId("tree-folder-Internal").locator("svg").nth(1)).toHaveCSS("color", "rgb(18, 58, 188)");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("accent-picker").getByRole("radio", { name: "#123abc" }).click();
  await expect(page.locator("html")).toHaveCSS("--primary", "#123abc");
});

test("a note with an image (no title) opens", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?empty");
  await expect(page.getByTestId("tab")).toHaveCount(1);
  // An external file with a stand-alone image (becomes an image block) and no title.
  await page.evaluate(async () => {
    const { vault } = (window as unknown as { __wn: { vault: { writeText(p: string, t: string): Promise<void>; emitChange(): void } } }).__wn;
    await vault.writeText("Img.md", ["Before", "", "![shot](_attachments/shot.png)", "", "After", ""].join("\n"));
    vault.emitChange();
  });
  await page.getByTestId("tree-note-Img").click();
  await expect(page.getByTestId("note-editor")).toContainText("After", { timeout: 10_000 });
  expect(errors.filter((e) => e.includes("caption"))).toEqual([]);
});

test("attachments in the folder panel (trash + restore), video/audio players, links don't navigate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab")).toHaveCount(1);
  await page.evaluate(async () => {
    const { vault } = (window as unknown as { __wn: { vault: { writeBinary(p: string, d: Uint8Array): Promise<void>; writeText(p: string, t: string): Promise<void>; emitChange(): void } } }).__wn;
    await vault.writeBinary("Internal/_attachments/clip.mp4", new Uint8Array([0]));
    await vault.writeBinary("Internal/_attachments/memo.mp3", new Uint8Array([0]));
    await vault.writeText("Internal/Media.md", ["[clip.mp4](_attachments/clip.mp4)", "", "[memo.mp3](_attachments/memo.mp3)", "", "Inline [clip.mp4](_attachments/clip.mp4) link", ""].join("\n"));
    vault.emitChange();
  });
  await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-Media").click();
  const editor = page.getByTestId("note-editor");
  await expect(editor.locator(".media-player")).toHaveCount(2); // not for the inline link

  // No new window when Ctrl/⌘+clicking a link
  const popups: unknown[] = [];
  page.on("popup", (p) => popups.push(p));
  await editor.locator(".file-link").last().click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await page.waitForTimeout(300);
  expect(popups.length).toBeLessThanOrEqual(1); // opening the file itself (browser build) is allowed once

  await page.getByTestId("tree-folder-Internal").locator("span.truncate").click();
  const panel = page.getByTestId("folder-panel");
  await expect(panel.getByTestId("attachment")).toHaveCount(2);
  await panel.getByTestId("attachment").filter({ hasText: "memo.mp3" }).hover();
  await panel.getByTestId("attachment").filter({ hasText: "memo.mp3" }).getByTestId("attachment-trash").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Media");
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(panel.getByTestId("attachment")).toHaveCount(1);

  await page.getByTestId("nav-trash").click();
  await page.getByTestId("trash-item").filter({ hasText: "memo.mp3" }).getByRole("button", { name: "Restore" }).click();
  await page.getByTestId("tree-folder-Internal").locator("span.truncate").click();
  await expect(page.getByTestId("folder-panel").getByTestId("attachment")).toHaveCount(2);
});

/** A real (tiny) WebM video, recorded from a canvas in the page. */
async function writeTestVideo(page: Page, path: string) {
  await page.evaluate(async (p) => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const g = c.getContext("2d")!;
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsl(${i * 40} 70% 50%)`;
      g.fillRect(0, 0, 160, 90);
      await new Promise((r) => setTimeout(r, 60));
    }
    rec.stop();
    await done;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    const { vault } = (window as unknown as { __wn: { vault: { writeBinary(p: string, d: Uint8Array): Promise<void>; emitChange(): void } } }).__wn;
    await vault.writeBinary(p, bytes);
  }, path);
}

test("custom video player: resize is saved with the link; /video offers existing files first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab")).toHaveCount(1);
  await writeTestVideo(page, "Internal/_attachments/clip.webm");
  await newNote(page, "Movie");

  // /video: the folder already has a video, so a list is shown (with an upload button)
  await page.keyboard.type("/video", { delay: 30 });
  await page.keyboard.press("Enter");
  const picker = page.getByTestId("attachment-picker");
  await expect(picker.getByTestId("picker-upload")).toBeVisible();
  await picker.getByTestId("picker-file").filter({ hasText: "clip.webm" }).click();
  const player = page.getByTestId("video-player");
  await expect(player).toBeVisible();
  await expect.poll(() => readVaultFile(page, "Internal/Movie.md")).toContain("[clip.webm](_attachments/clip.webm)");

  // Play / pause with our own controls
  await player.hover();
  await player.getByRole("button", { name: "Play" }).first().click();
  await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  await player.getByRole("button", { name: "Pause" }).click();

  // Drag the corner to resize; the width is stored in the link title
  const box = (await player.boundingBox())!;
  await player.hover();
  const h = (await player.getByTestId("video-resize").boundingBox())!;
  await page.mouse.move(h.x + 8, h.y + 8);
  await page.mouse.down();
  await page.mouse.move(h.x + 8 - 200, h.y + 8, { steps: 6 });
  await page.mouse.up();
  expect((await player.boundingBox())!.width).toBeLessThan(box.width - 150);
  await expect.poll(() => readVaultFile(page, "Internal/Movie.md")).toMatch(/_attachments\/clip\.webm "width=\d+"\)/);
});

test("explorer multi-select: Ctrl/⌘+click and Shift+click, Delete trashes all, Enter opens all", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tree-folder-Acme migration").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-Project plan").click();
  await page.getByTestId("tree-note-1-on-1 notes").click({ modifiers: [mod] });
  await page.keyboard.press("Enter");
  const tabs = page.getByTestId("tab");
  await expect(tabs.filter({ hasText: "Project plan" })).toHaveCount(1);
  await expect(tabs.filter({ hasText: "1-on-1 notes" })).toHaveCount(1);

  // Shift+click selects the range in between (Project plan … 1-on-1 notes includes the Internal folder)
  await page.getByTestId("tree-note-Project plan").click();
  await page.getByTestId("tree-note-1-on-1 notes").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toContainText("Move 2 items to trash?"); // the note inside Internal goes with the folder
  await expect(dialog).toContainText("Internal (folder, with everything in it)");
  await dialog.getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByTestId("tree-note-Project plan")).toHaveCount(0);
  await expect(page.getByTestId("tree-folder-Internal")).toHaveCount(0);
  await expect(tabs.filter({ hasText: "1-on-1 notes" })).toHaveCount(0);
});

test("images are left-aligned and resize from the corner; audio has a vertical volume slider", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab")).toHaveCount(1);
  await page.evaluate(async () => {
    const { vault } = (window as unknown as { __wn: { vault: { writeBinary(p: string, d: Uint8Array): Promise<void>; writeText(p: string, t: string): Promise<void>; emitChange(): void } } }).__wn;
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3b82f6";
    g.fillRect(0, 0, 400, 200);
    const png = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    await vault.writeBinary("Internal/_attachments/pic.png", new Uint8Array(await png.arrayBuffer()));
    // 1 s of silence as WAV
    const rate = 8000, n = rate;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    await vault.writeBinary("Internal/_attachments/memo.wav", new Uint8Array(buf));
    await vault.writeText("Internal/Pics.md", ["Text", "", "![](_attachments/pic.png)", "", "[memo.wav](_attachments/memo.wav)", ""].join(String.fromCharCode(10)));
    vault.emitChange();
  });
  await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-Pics").click();
  const editor = page.getByTestId("note-editor");
  const img = editor.locator(".milkdown-image-block img");
  await expect(img).toBeVisible();
  const text = (await editor.locator(".ProseMirror > p").first().boundingBox())!;
  const before = (await img.boundingBox())!;
  expect(Math.abs(before.x - text.x)).toBeLessThan(4); // left-aligned with the text

  await img.hover();
  const handle = editor.locator(".milkdown-image-block .image-resize-handle");
  await expect(handle).toHaveCSS("opacity", "1");
  const h = (await handle.boundingBox())!;
  expect(h.x + h.width).toBeGreaterThan(before.x + before.width - 4); // bottom-right corner
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 150, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await img.boundingBox())!;
  expect(after.width).toBeLessThan(before.width - 100);
  expect(Math.abs(after.x - before.x)).toBeLessThan(2); // still on the left
  expect(after.height / after.width).toBeCloseTo(0.5, 1); // aspect ratio kept
  await expect.poll(() => readVaultFile(page, "Internal/Pics.md")).toMatch(/!\[0\.\d+\]\(_attachments\/pic\.png\)/);

  // Volume: hover the speaker for a vertical slider
  const audio = page.getByTestId("audio-player");
  await expect(page.getByTestId("volume-popup")).toBeHidden();
  await audio.getByRole("button", { name: "Mute" }).hover();
  const slider = page.getByTestId("volume-slider");
  await expect(slider).toBeVisible();
  const sb = (await slider.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height * 0.25);
  await page.mouse.down();
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", /^(7[0-9]|80)$/);
  await page.mouse.move(10, 10);
  await expect(page.getByTestId("volume-popup")).toBeHidden(); // closes when the mouse leaves, even after clicking
});
