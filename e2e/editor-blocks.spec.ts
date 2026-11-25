import { expect, test, type Page } from "@playwright/test";

// Highlight, toggle, Notion-style typing, "turn into" from the drag handle, lists in columns, and plugins' editor items.

type Vault = { writeText(p: string, t: string): Promise<void>; readText(p: string): Promise<string>; emitChange(): void };
type Wn = { __wn: { vault: Vault; installPlugin(files: Record<string, string>): Promise<{ error?: string }> } };

const mod = process.platform === "darwin" ? "Meta" : "Control";
/** Home/End don't move the cursor on macOS. */
const lineStart = process.platform === "darwin" ? "Meta+ArrowLeft" : "Home";
const lineEnd = process.platform === "darwin" ? "Meta+ArrowRight" : "End";
const editor = (page: Page) => page.getByTestId("note-editor");

/** A note in Internal with this markdown, opened. */
async function noteWith(page: Page, title: string, body: string) {
  await page.evaluate(
    async ([t, b]) => {
      const { vault } = (window as unknown as Wn).__wn;
      await vault.writeText(`Internal/${t}.md`, `---\nid: ${t.toLowerCase().replace(/\W/g, "")}\n---\n\n${b}`);
      vault.emitChange();
    },
    [title, body],
  );
  const row = page.getByTestId(`tree-note-${title}`);
  if (!(await row.isVisible())) await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await row.click();
  await expect(page.getByTestId("note-title")).toHaveValue(title);
}

const file = (page: Page, title: string) => page.evaluate((t) => (window as unknown as Wn).__wn.vault.readText(`Internal/${t}.md`), title);

/** Hover a block, click its drag handle: the block menu. */
async function blockMenu(page: Page, block: ReturnType<Page["locator"]>) {
  await block.hover();
  const handle = page.locator(".milkdown-block-handle .operation-item").last();
  await expect(handle).toBeVisible();
  await handle.click();
  await expect(page.getByTestId("block-menu")).toBeVisible();
  return page.getByTestId("block-menu");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
});

test("==highlight== and <details> toggles are read and written back as they were", async ({ page }) => {
  await noteWith(page, "Blocks", "Some ==marked== text.\n\n<details>\n<summary>More &amp; info</summary>\n\nHidden line\n\n</details>\n\nAfter");
  await expect(editor(page).locator("mark")).toHaveText("marked");
  const toggle = editor(page).locator(".toggle-block");
  await expect(toggle.locator(".toggle-summary")).toHaveText("More & info");
  await expect(editor(page).getByText("Hidden line")).toBeHidden(); // a note opens with its toggles closed
  await toggle.locator(".toggle-arrow").click();
  await expect(editor(page).getByText("Hidden line")).toBeVisible();

  // Delete at the end of the line above steps into the title; nothing is merged or lost
  await editor(page).getByText("text.").click();
  await page.keyboard.press(lineEnd);
  await page.keyboard.press("Delete");
  await page.keyboard.type("Even ");
  await expect(toggle.locator(".toggle-summary")).toHaveText("Even More & info");
  await expect(editor(page).getByText("Hidden line")).toBeVisible();

  // An edit elsewhere saves the note: highlight and toggle come back unchanged (opening a toggle isn't saved)
  await editor(page).getByText("After").click();
  await page.keyboard.press(lineEnd);
  await page.keyboard.type(" too");
  await expect.poll(() => file(page, "Blocks")).toContain("After too");
  const md = await file(page, "Blocks");
  expect(md).toContain("Some ==marked== text.");
  expect(md).toContain("<details>\n<summary>Even More &amp; info</summary>\n\nHidden line\n\n</details>");
  expect(md).not.toContain("<details open");
});

test("typing: ==text==, ⌘⇧H, /toggle with Enter into its content, Backspace unwraps it", async ({ page }) => {
  await noteWith(page, "Typing", "");
  await editor(page).locator(".ProseMirror").click();
  await page.keyboard.type("A ==bright== idea and more", { delay: 10 });
  await expect(editor(page).locator("mark")).toHaveText("bright");
  // Select "more" and highlight it with the shortcut
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press(`${mod}+Shift+H`);
  await expect(editor(page).locator("mark")).toHaveText(["bright", "more"]);
  await page.waitForTimeout(300); // the selection toolbar comes up
  await page.keyboard.press(lineEnd);
  await page.keyboard.press("Enter");

  await page.keyboard.type("/toggle", { delay: 30 });
  await expect(page.locator(".milkdown-slash-menu")).toContainText("Toggle");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Details");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Inside it");
  await expect(editor(page).locator(".toggle-summary")).toHaveText("Details");
  await expect(editor(page).locator(".toggle-content > p")).toHaveText("Inside it");
  await expect.poll(() => file(page, "Typing")).toContain("<details>\n<summary>Details</summary>\n\nInside it\n\n</details>");
  expect(await file(page, "Typing")).toContain("A ==bright== idea and ==more==");

  // Backspace at the start of the title: back to plain lines, nothing lost
  await editor(page).locator(".toggle-summary").click();
  await page.keyboard.press(lineStart);
  await page.keyboard.press("Backspace");
  await expect(editor(page).locator(".toggle-block")).toHaveCount(0);
  await expect.poll(() => file(page, "Typing")).toMatch(/Details\n\nInside it/);
});

test("Notion-style typing: off, > makes a quote; on, \" makes a quote and > a toggle", async ({ page }) => {
  await noteWith(page, "Quotes", "");
  await editor(page).locator(".ProseMirror").click();
  await page.keyboard.type("> plain quote", { delay: 20 });
  await expect(editor(page).locator("blockquote")).toHaveText("plain quote");

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-tab-shortcuts").click();
  await page.getByTestId("notion-typing").click();
  await expect(page.getByTestId("notion-typing")).toBeChecked();

  await noteWith(page, "Notion", "");
  await editor(page).locator(".ProseMirror").click();
  await page.keyboard.type('" said so', { delay: 20 });
  await expect(editor(page).locator("blockquote")).toHaveText("said so");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // out of the quote
  await page.keyboard.type("> Folded", { delay: 20 });
  await expect(editor(page).locator(".toggle-summary")).toHaveText("Folded");
  await expect.poll(() => file(page, "Notion")).toContain("> said so");
  expect(await file(page, "Notion")).toContain("<summary>Folded</summary>");
});

test("turn into from the drag handle: heading, list, toggle and back, as one undo step", async ({ page }) => {
  await noteWith(page, "Turn", "First line\n\nSecond line");
  const first = editor(page).locator("p", { hasText: "First line" });
  let menu = await blockMenu(page, first);
  await expect(menu.getByTestId("turn-into-text")).toHaveCount(0); // it is text already
  await menu.getByTestId("turn-into-h2").click();
  await expect(editor(page).locator("h2")).toHaveText("First line");

  menu = await blockMenu(page, editor(page).locator("h2"));
  await menu.getByTestId("turn-into-toggle").click();
  await expect(editor(page).locator(".toggle-summary")).toHaveText("First line");
  await page.keyboard.press(`${mod}+z`);
  await expect(editor(page).locator("h2")).toHaveText("First line");

  menu = await blockMenu(page, editor(page).locator("p", { hasText: "Second line" }));
  await menu.getByTestId("turn-into-numbered").click();
  await expect(editor(page).locator("ol li")).toContainText("Second line");
  await expect.poll(() => file(page, "Turn")).toMatch(/## First line\n\n1\. Second line/);
});

test("turning a todo line into something else asks what happens to the todo", async ({ page }) => {
  await noteWith(page, "Todo lines", "");
  await editor(page).locator(".ProseMirror").click();
  await page.keyboard.type("- [ ] Call Jan", { delay: 20 });
  await expect.poll(() => file(page, "Todo lines")).toMatch(/[-*] \[ \] Call Jan \^t-[a-z0-9]+/);

  const item = editor(page).locator("li", { hasText: "Call Jan" });
  let menu = await blockMenu(page, item);
  await menu.getByTestId("turn-into-text").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toContainText("Call Jan");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editor(page).locator("li", { hasText: "Call Jan" })).toBeVisible(); // nothing happened

  menu = await blockMenu(page, item);
  await menu.getByTestId("turn-into-text").click();
  await dialog.getByTestId("choice-trash").click();
  await expect(editor(page).locator("p", { hasText: "Call Jan" })).toBeVisible();
  await expect.poll(() => file(page, "Todo lines")).toMatch(/^Call Jan$/m); // no marker left in the text
  await page.getByTestId("nav-all").click();
  await expect(page.getByTestId("todo-row").filter({ hasText: "Call Jan" })).toHaveCount(0);
});

test("long lists of short items flow into columns; the setting turns it off", async ({ page }) => {
  const items = Array.from({ length: 10 }, (_, i) => `- Item ${i + 1}`).join("\n");
  await noteWith(page, "Groceries", `${items}\n\n- Just\n- Three\n- Items`);
  await expect(editor(page).locator("ul.list-columns")).toHaveCount(1);
  expect(await editor(page).locator("ul.list-columns").evaluate((el) => getComputedStyle(el).columnCount !== "1" || getComputedStyle(el).columnWidth !== "auto")).toBe(true);
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-tab-appearance").click();
  await page.getByTestId("list-columns").click();
  await page.getByTestId("tab").filter({ hasText: "Groceries" }).click();
  await expect(editor(page).locator("ul.list-columns")).toHaveCount(0);
});

test("a plugin adds a code block preview, a / item and a block menu item", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const main = `const React = require("react");
  module.exports = () => ({
    editor: {
      codeBlockRenderers: { shout: ({ code }) => React.createElement("div", { "data-testid": "shout" }, code.toUpperCase()) },
      slashItems: [{ id: "stamp", label: "Insert stamp", keywords: "date", run: (e) => e.insertMarkdown("Stamped in " + e.notePath) }],
      blockMenuItems: [{ id: "double", label: "Say it twice", show: (b) => b.type === "paragraph", run: (b) => b.replaceWith(b.markdown + "\\n\\n" + b.markdown) }],
    },
  });`;
  const manifest = JSON.stringify({ id: "edits", name: "Edits", version: "0.1.0", author: "Test", description: "Editor things." });
  const r = await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest, main]);
  expect(r.error).toBeUndefined();

  await noteWith(page, "Plugged", "Echo me\n\n```shout\nhello\n```");
  await expect(editor(page).getByTestId("shout")).toHaveText("HELLO");

  const menu = await blockMenu(page, editor(page).locator("p", { hasText: "Echo me" }));
  await expect(menu).toContainText("Edits");
  await menu.getByTestId("block-item-edits:double").click();
  await expect(editor(page).locator("p", { hasText: "Echo me" })).toHaveCount(2);

  await editor(page).locator("p", { hasText: "Echo me" }).last().click();
  await page.keyboard.press(lineEnd);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/stamp", { delay: 30 });
  await expect(page.locator(".milkdown-slash-menu")).toContainText("Insert stamp");
  await page.keyboard.press("Enter");
  await expect(editor(page)).toContainText("Stamped in Internal/Plugged.md");
  expect(errors).toEqual([]);
});
