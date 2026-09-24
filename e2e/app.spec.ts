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
  await expect(page.getByTestId("folder-view")).toContainText("Client Y");

  // Create a note in it
  await page.getByRole("button", { name: "New note" }).first().click();
  const title = page.getByTestId("note-title");
  await title.fill("Planning");
  await title.press("Enter");
  await page.keyboard.type("Kickoff went well.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- [ ] Draft the proposal");

  // The inline todo is created and linked to the note
  const linked = page.getByTestId("note-linked-todos");
  await expect(linked.getByTestId("todo-row")).toHaveAttribute("data-title", "Draft the proposal", { timeout: 10_000 });
  await expect.poll(() => readVaultFile(page, "Client Y/Planning.md")).toMatch(/- \[ \] Draft the proposal \^t-[a-z0-9]+|\* \[ \] Draft the proposal \^t-[a-z0-9]+/);

  // Give it a due date of today in the detail panel
  await linked.getByTestId("todo-row").click();
  const detail = page.getByTestId("todo-detail");
  await expect(detail.getByTestId("detail-title")).toHaveValue("Draft the proposal");
  await detail.getByRole("button", { name: "Today" }).first().click();

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
  await page.getByTestId("tree-folder-Internal").click();
  await page.getByTestId("tree-note-1-on-1 notes").click({ button: "right" });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
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
