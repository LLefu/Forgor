import { expect, test, type Page } from "@playwright/test";

async function readVaultFile(page: Page, suffix: string) {
  return page.evaluate(async (s) => {
    const { vault } = (window as unknown as { __wn: { vault: { list(): Promise<{ path: string }[]>; readText(p: string): Promise<string> } } }).__wn;
    const f = (await vault.list()).find((e) => e.path.endsWith(s));
    return f ? vault.readText(f.path) : null;
  }, suffix);
}

test("folder → note → inline todo → Today, Calendar and Search", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?empty");

  // Create a project folder
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByTestId("explorer").locator("input")).toBeFocused();
  await page.keyboard.type("Client Y");
  await page.keyboard.press("Enter");
  await page.getByTestId("tree-folder-Client Y").click();
  await expect(page.getByTestId("folder-panel").getByTestId("folder-name")).toHaveValue("Client Y");

  // Create a note in it
  await page.getByRole("button", { name: "New note" }).first().click();
  const title = page.getByTestId("note-title");
  await title.fill("Planning");
  await title.press("Enter");
  await page.keyboard.type("Kickoff went well.");
  await page.keyboard.press("Enter");
  // Type the list prefix at human speed: the editor converts "- [ ] " into a checkbox
  // and a zero-delay keystroke can land before that conversion finishes.
  await page.keyboard.type("- [ ] ", { delay: 60 });
  await page.keyboard.type("Draft the proposal");

  // The inline todo is created and linked to the note
  const linked = page.getByTestId("note-linked-todos");
  await expect(linked.getByTestId("todo-row")).toHaveAttribute("data-title", "Draft the proposal", { timeout: 10_000 });
  await expect.poll(() => readVaultFile(page, "Client Y/Planning.md")).toMatch(/- \[ \] Draft the proposal \^t-[a-z0-9]+|\* \[ \] Draft the proposal \^t-[a-z0-9]+/);

  // Give it a due date of today in the detail panel
  await linked.getByTestId("todo-row").click();
  const detail = page.getByTestId("todo-detail");
  await expect(detail.getByTestId("detail-title")).toHaveValue("Draft the proposal");
  await detail.getByTestId("due-date").click();
  await page.getByTestId("date-picker").getByRole("button", { name: "Today", exact: true }).click();
  await expect(detail.getByTestId("due-date")).toContainText("Today");

  // It shows up in Today, with the note badge
  await page.getByTestId("nav-today").click();
  const row = page.locator('[data-testid="todo-row"][data-title="Draft the proposal"]');
  await expect(row).toBeVisible();
  await expect(row.getByTestId("note-badge")).toHaveText("1");

  // …and in the calendar
  await page.getByTestId("nav-calendar").click();
  await expect(page.getByTestId("calendar")).toContainText("Draft the proposal");

  // Completing it updates the checkbox inside the markdown file
  await page.getByTestId("nav-today").click();
  await row.getByRole("checkbox").click();
  await expect.poll(() => readVaultFile(page, "Client Y/Planning.md")).toMatch(/\[x\] Draft the proposal/);

  // Search finds the note by its content
  await page.getByTestId("nav-search").click();
  await page.getByTestId("search-input").fill("kickoff");
  await expect(page.getByTestId("search-note-hit")).toContainText("Planning");

  expect(errors).toEqual([]);
});

test("trash and restore a note", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-1-on-1 notes").click({ button: "right" });
  // Native confirm() must never be used (unsupported in the macOS webview).
  page.on("dialog", () => {
    throw new Error("native dialog opened");
  });
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Move to trash" }).click();
  await expect(page.getByTestId("tree-note-1-on-1 notes")).toHaveCount(0);

  await page.getByTestId("nav-trash").click();
  await expect(page.getByTestId("trash-item")).toContainText("1-on-1 notes");
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByTestId("tree-note-1-on-1 notes")).toBeVisible();
});

test("theme toggle switches to dark mode", async ({ page }) => {
  await page.goto("/?empty");
  const html = page.locator("html");
  await page.getByRole("button", { name: "Toggle theme" }).click(); // system → light
  await page.getByRole("button", { name: "Toggle theme" }).click(); // light → dark
  await expect(html).toHaveClass(/dark/);
});

test("date & time pickers, folder colors and All tasks", async ({ page }) => {
  await page.goto("/");
  // Custom date picker: opens, closes on an outside click, sets and clears a date.
  await page.getByTestId("nav-inbox").click();
  await page.locator('[data-testid="todo-row"][data-title="Read architecture RFC"]').click();
  const detail = page.getByTestId("todo-detail");
  await detail.getByTestId("due-date").click();
  await expect(page.getByTestId("date-picker")).toBeVisible();
  // Radix attaches its outside-click listener a tick after opening, so retry the click
  await expect(async () => {
    await page.mouse.click(600, 700); // outside
    await expect(page.getByTestId("date-picker")).toHaveCount(0, { timeout: 500 });
  }).toPass();
  await detail.getByTestId("due-date").click();
  await page.getByTestId("date-picker").getByRole("button", { name: "Tomorrow" }).click();
  await expect(detail.getByTestId("due-date")).toContainText("Tomorrow");
  // Time picker: type a time
  await detail.getByTestId("due-time").click();
  await page.getByTestId("time-picker").getByLabel("Type a time").fill("930");
  await page.keyboard.press("Enter");
  await expect(detail.getByTestId("due-time")).toHaveText("09:30");
  // ...and "No date" removes it again
  await detail.getByTestId("due-date").click();
  await page.getByTestId("date-picker").getByRole("button", { name: "No date" }).click();
  await expect(detail.getByTestId("due-date")).toHaveText("No date");
  await page.keyboard.press("Escape");

  // Folder color: set it on the folder page, see it in the explorer and on todo rows
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await page.getByTestId("folder-color-button").click();
  await page.getByRole("radio", { name: "Teal" }).click();
  const teal = "rgb(20, 184, 166)";
  await expect(page.getByTestId("tree-folder-Acme migration").locator("svg").nth(1)).toHaveCSS("color", teal);
  await expect(page.getByTestId("folder-panel").locator("svg.lucide-folder").first()).toHaveCSS("color", teal);

  // Right-click → Color picks a color AND closes the menu (it used to stay open and block the page)
  await page.getByTestId("tree-folder-Internal").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Color" }).hover();
  await page.getByRole("radio", { name: "Orange" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByTestId("tree-folder-Internal").locator("svg").nth(1)).toHaveCSS("color", "rgb(249, 115, 22)");

  // All tasks: sort by folder groups the list per folder
  await page.getByTestId("nav-all").click();
  await page.getByRole("radio", { name: "Folder" }).click();
  await expect(page.getByRole("main")).toContainText("Inbox (no folder)");
  await expect(page.getByRole("main")).toContainText("Acme migration");
});
