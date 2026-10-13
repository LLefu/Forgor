import { test, expect, type Page } from "@playwright/test";

// The browser build talks to a fake Jira (src/platform/jira.ts): boards "WEB board" / "APP board",
// tickets WEB-12, WEB-15, WEB-9 (open), WEB-3 (done), APP-41, APP-38; the token "wrong" is rejected.

async function connect(page: Page) {
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("jira-toggle").click();
  await page.getByTestId("jira-connect").click();
  const dialog = page.getByTestId("jira-connect-dialog");
  await dialog.getByLabel("Jira address").fill("acme");
  await dialog.getByLabel("Email").fill("demo@example.com");
  await dialog.getByLabel("API token").fill("wrong");
  await dialog.getByTestId("jira-connect-submit").click();
  await expect(dialog.getByTestId("jira-connect-error")).toContainText("didn't accept");
  await dialog.getByLabel("API token").fill("secret-token");
  await dialog.getByTestId("jira-connect-submit").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");
  await expect(page.getByTestId("jira-account")).toContainText("acme.atlassian.net");
}

test("the calendar is gone; Jira is off until turned on", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-calendar")).toHaveCount(0);
  await expect(page.getByTestId("nav-jira")).toHaveCount(0);
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await expect(page.getByTestId("folder-panel")).not.toContainText("Jira");
});

test("overview: all my tickets, with search, filters and sorting; a ticket opens on the right", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await connect(page);

  await page.getByTestId("nav-jira").click();
  const list = page.getByTestId("jira-list");
  const keys = () => list.getByTestId("issue-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-key")));
  await expect(list.getByTestId("issue-row")).toHaveCount(5); // open only
  await expect.poll(keys).toEqual(["APP-41", "WEB-12", "WEB-9", "WEB-15", "APP-38"]); // last updated first

  await page.getByLabel("Sort by").selectOption("priority");
  await expect.poll(keys).toEqual(["APP-41", "WEB-12", "WEB-15", "APP-38", "WEB-9"]);
  await page.getByLabel("Project").selectOption("WEB");
  await expect(list.getByTestId("issue-row")).toHaveCount(3);
  await page.getByLabel("Status").selectOption("done");
  await expect.poll(keys).toEqual(["WEB-3"]);
  await page.getByLabel("Status").selectOption("open");
  await page.getByLabel("Search tickets").fill("dark mode");
  await expect.poll(keys).toEqual(["WEB-15"]);

  await list.getByTestId("issue-row").first().click();
  const panel = page.getByTestId("issue-panel");
  await expect(panel.getByTestId("issue-summary")).toHaveText("Add dark mode to the marketing site");
  await expect(panel.getByTestId("issue-description")).toContainText("Description of WEB-15.");
  await expect(panel.getByTestId("issue-comments")).toContainText("Can you look at this before Friday?");
  await expect(panel.getByTestId("open-in-jira")).toBeVisible();

  // Images in the description are shown (fetched with the login), not linked
  await page.getByLabel("Search tickets").fill("");
  await list.locator('[data-key="WEB-12"]').click();
  await expect(panel.getByTestId("jira-image")).toHaveAttribute("alt", "hero.svg");
  await expect.poll(() => panel.getByTestId("jira-image").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
  expect(errors).toEqual([]);
});

test("a folder links one or more boards: my tickets under the notes, View all, back from a ticket", async ({ page }) => {
  await page.goto("/");
  await connect(page);
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  const folder = page.getByTestId("folder-panel");
  const section = folder.getByTestId("folder-jira");
  const pick = async (search: string) => {
    await section.getByTestId("jira-link-board").click();
    await page.waitForTimeout(300); // the list stays open
    await section.getByTestId("jira-board-picker").getByLabel("Search boards").fill(search);
    await expect(section.getByTestId("jira-board-option")).toHaveCount(1);
    await section.getByTestId("jira-board-option").click();
  };

  await pick("web");
  await expect(section.getByTestId("jira-board-chip")).toHaveText(["WEB board"]);
  await expect(section.getByTestId("issue-row")).toHaveCount(3);
  // Below the notes
  const below = await folder.evaluate((el) => {
    const headings = [...el.querySelectorAll("section > button")].map((b) => b.textContent ?? "");
    return headings.findIndex((h) => h.startsWith("Notes")) < headings.findIndex((h) => h.startsWith("Jira"));
  });
  expect(below).toBe(true);

  // A second board: its tickets join the list
  await pick("app");
  await expect(section.getByTestId("jira-board-chip")).toHaveText(["WEB board", "APP board"]);
  await expect(section.getByTestId("issue-row")).toHaveCount(5);
  // A board that's already linked isn't offered again
  await section.getByTestId("jira-link-board").click();
  await section.getByLabel("Search boards").fill("board");
  await expect(section.getByTestId("jira-board-option").filter({ hasText: /^(WEB|APP) board/ })).toHaveCount(0);
  await section.getByTestId("jira-board-cancel").click();
  await expect(section.getByTestId("jira-board-picker")).toHaveCount(0);
  // Esc cancels too (and leaves the folder panel open)
  await section.getByTestId("jira-link-board").click();
  await section.getByLabel("Search boards").press("Escape");
  await expect(section.getByTestId("jira-board-picker")).toHaveCount(0);
  await expect(folder).toBeVisible();

  // Boards are found by project name too, also beyond the first page of 50
  await section.getByTestId("jira-link-board").click();
  await section.getByLabel("Search boards").fill("schadegarant");
  await expect(section.getByTestId("jira-board-option")).toHaveText([/Sprint board/]);
  await section.getByLabel("Search boards").fill("team 60");
  await expect(section.getByTestId("jira-board-option")).toHaveText([/Team 60 board/]);
  await section.getByLabel("Search boards").press("Escape");

  // A ticket opens in the panel, with a way back to the folder
  await section.getByTestId("issue-row").first().click();
  await expect(page.getByTestId("issue-panel")).toBeVisible();
  await page.getByRole("button", { name: "Back to the folder" }).click();
  await expect(section).toBeVisible();

  // View all → the folder's page with both boards
  await section.getByTestId("jira-view-all").click();
  await expect(page.getByTestId("tab").first()).toHaveAttribute("data-title", "Jira · Acme migration");
  await expect(page.getByTestId("jira-page")).toContainText("WEB board · APP board");
  await expect(page.getByTestId("jira-list").getByTestId("issue-row")).toHaveCount(5);

  // Unlink one board, then the other
  await section.getByRole("button", { name: "Unlink WEB board" }).click();
  await expect(section.getByTestId("jira-board-chip")).toHaveText(["APP board"]);
  await expect(section.getByTestId("issue-row")).toHaveCount(2);
  await section.getByRole("button", { name: "Unlink APP board" }).click();
  await expect(section.getByTestId("jira-board-chip")).toHaveCount(0);
  await expect(section.getByTestId("jira-link-board")).toHaveText(/Link a Jira board/);
});

test("disconnecting forgets the account", async ({ page }) => {
  await page.goto("/");
  await connect(page);
  await page.getByTestId("jira-disconnect").click();
  await page.getByRole("button", { name: "Disconnect" }).last().click();
  await expect(page.getByTestId("jira-connect")).toBeVisible();
  await page.getByTestId("nav-jira").click();
  await expect(page.getByTestId("jira-not-connected")).toBeVisible();
});

test("in the overview, tickets of a board linked to a folder with an icon show that icon", async ({ page }) => {
  await page.goto("/");
  await connect(page);
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  const folder = page.getByTestId("folder-panel");
  await folder.getByTestId("jira-link-board").click();
  await page.getByTestId("jira-board-picker").getByLabel("Search boards").fill("web");
  await expect(page.getByTestId("jira-board-option")).toHaveCount(1);
  await page.getByTestId("jira-board-option").click();
  await folder.getByTestId("folder-icon-button").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("folder-icon-upload").click();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#16a34a"/></svg>`;
  await (await chooser).setFiles({ name: "acme.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(folder.getByTestId("folder-icon").first()).toBeVisible();

  await page.getByTestId("nav-jira").click();
  const list = page.getByTestId("jira-list");
  await expect(list.locator('[data-key="WEB-12"]').getByTestId("issue-folder-icon")).toBeVisible();
  await expect(list.locator('[data-key="WEB-12"]').getByTestId("issue-folder-icon")).toHaveAttribute("title", "Acme migration · Priority: High");
  await expect(list.locator('[data-key="APP-41"]').getByTestId("issue-folder-icon")).toHaveCount(0);
  // The icon replaces the priority bar
  await expect(list.locator('[data-key="WEB-12"]').getByLabel(/^Priority:/)).toHaveCount(0);
  await expect(list.locator('[data-key="APP-41"]').getByLabel("Priority: Highest")).toBeVisible();
  // Titles line up with or without an icon
  const lefts = await list.getByTestId("issue-row").evaluateAll((rows) => rows.map((r) => Math.round(r.querySelector(".truncate")!.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
});
