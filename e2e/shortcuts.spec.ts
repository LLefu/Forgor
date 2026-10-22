import { test, expect, type Page } from "@playwright/test";
import { enablePlugin } from "./plugins";

// Mod = ⌘ on macOS, Ctrl elsewhere ("ControlOrMeta" in Playwright); "Ctrl+Tab" is the Control key on both.
const press = (page: Page, keys: string) => page.keyboard.press(keys);
const tabs = (page: Page) => page.getByTestId("tab");

async function openNote(page: Page, folder: string, note: string) {
  const row = page.getByTestId(`tree-note-${note}`);
  if (!(await row.isVisible())) await page.getByTestId(`tree-folder-${folder}`).getByTestId("tree-toggle").click();
  await row.click();
  await expect(page.getByTestId("note-title")).toHaveValue(note);
}

async function openShortcutSettings(page: Page) {
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-tab-shortcuts").click();
  await expect(page.getByTestId("shortcuts-settings")).toBeVisible();
}

test("Settings has tabs; Shortcuts lists the app's shortcuts with their keys", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  for (const t of ["general", "appearance", "todos", "notifications", "models", "shortcuts"]) await expect(page.getByTestId(`settings-tab-${t}`)).toBeVisible();
  await expect(page.getByTestId("updates")).toBeVisible(); // General first
  await page.getByTestId("settings-tab-appearance").click();
  await expect(page.getByLabel("Theme", { exact: true })).toBeVisible();
  await expect(page.getByTestId("updates")).toHaveCount(0);

  await page.getByTestId("settings-tab-shortcuts").click();
  const settings = page.getByTestId("shortcuts-settings");
  for (const label of ["New note", "New todo", "New folder", "Quick open", "Reopen closed tab", "Show or hide the sidebar", "All keyboard shortcuts", "Go to tab 1–9"]) {
    await expect(settings).toContainText(label);
  }
  await expect(page.getByTestId("shortcut-new-note").getByTestId("shortcut-keys")).toHaveText(/^(⌘N|Ctrl\+N)$/);
});

test("new note, new todo and new folder from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-today").click();
  const before = await tabs(page).count();
  await press(page, "ControlOrMeta+n");
  await expect(tabs(page)).toHaveCount(before + 1);
  await expect(tabs(page).nth(before)).toHaveAttribute("data-title", "Untitled");
  await press(page, "Escape"); // leave the rename

  await page.getByTestId("main").click({ position: { x: 5, y: 5 } });
  await press(page, "ControlOrMeta+Shift+a");
  await expect(page.getByRole("dialog")).toBeVisible();
  await press(page, "Escape");

  await page.getByTestId("main").click({ position: { x: 5, y: 5 } });
  await press(page, "ControlOrMeta+Shift+n");
  await expect(page.getByTestId("tree-folder-New folder")).toBeVisible();
});

test("tabs: close, reopen, jump by number, next/previous; go to pages", async ({ page }) => {
  await page.goto("/");
  await openNote(page, "Acme migration", "Project plan");
  await openNote(page, "Internal", "1-on-1 notes");
  const n = await tabs(page).count();
  await expect(tabs(page).nth(n - 1)).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("main").click({ position: { x: 5, y: 5 } });
  await press(page, "ControlOrMeta+w");
  await expect(tabs(page)).toHaveCount(n - 1);
  await press(page, "ControlOrMeta+Shift+t");
  await expect(tabs(page)).toHaveCount(n);
  await expect(page.locator('[data-testid="tab"][data-title="1-on-1 notes"]')).toHaveCount(1);

  await press(page, "ControlOrMeta+1");
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await press(page, "ControlOrMeta+9");
  await expect(tabs(page).nth(n - 1)).toHaveAttribute("aria-selected", "true");
  await press(page, "Control+Tab");
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await press(page, "Control+Shift+Tab");
  await expect(tabs(page).nth(n - 1)).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("main").click({ position: { x: 5, y: 5 } });
  await press(page, "ControlOrMeta+Shift+l");
  await expect(page.getByRole("heading", { name: "Todos", exact: true })).toBeVisible();
  await press(page, "ControlOrMeta+Shift+d");
  await expect(page.getByTestId("today-page")).toBeVisible();
  await press(page, "ControlOrMeta+,");
  await expect(page.getByTestId("settings-tabs")).toBeVisible();
});

test("the sidebar hides and comes back; ⌘/ shows every shortcut", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("today-page")).toBeVisible(); // settings loaded
  await press(page, "ControlOrMeta+Backslash");
  await expect(page.getByTestId("nav-today")).toHaveCount(0);
  await page.getByTestId("show-sidebar").click();
  await expect(page.getByTestId("nav-today")).toBeVisible();
  await page.getByTestId("hide-sidebar").click();
  await expect(page.getByTestId("nav-today")).toHaveCount(0);
  await press(page, "ControlOrMeta+Backslash");
  await expect(page.getByTestId("nav-today")).toBeVisible();

  await press(page, "ControlOrMeta+/");
  const help = page.getByTestId("shortcuts-help");
  await expect(help).toContainText("New note");
  await expect(help).toContainText("Zoom in / out / reset");
  await press(page, "ControlOrMeta+/");
  await expect(help).toHaveCount(0);
  await press(page, "ControlOrMeta+/");
  await help.getByRole("button", { name: "Change shortcuts" }).click();
  await expect(page.getByTestId("shortcuts-settings")).toBeVisible();
});

test("changing a shortcut: new keys work, old ones don't; taken and reserved keys are refused; reset", async ({ page }) => {
  await page.goto("/");
  await openShortcutSettings(page);
  const row = page.getByTestId("shortcut-new-note");

  // Taken: refused, with who has it
  await row.getByRole("button", { name: /^Change / }).click();
  await expect(row.getByTestId("shortcut-recording")).toBeVisible();
  await press(page, "ControlOrMeta+k");
  await expect(row.getByTestId("shortcut-error")).toContainText("Search page");
  // Reserved
  await press(page, "ControlOrMeta+c");
  await expect(row.getByTestId("shortcut-error")).toContainText("copy, paste");
  // A plain letter isn't enough
  await press(page, "j");
  await expect(row.getByTestId("shortcut-error")).toContainText("plain keys are for typing");
  // Free: saved
  await press(page, "ControlOrMeta+Alt+j");
  await expect(row.getByTestId("shortcut-keys")).toHaveText(/^(⌥⌘J|Ctrl\+Alt\+J)$/);
  await expect(row.getByTestId("shortcut-error")).toHaveCount(0);

  await page.getByTestId("nav-today").click();
  const count = await tabs(page).count();
  await press(page, "ControlOrMeta+n");
  await expect(tabs(page)).toHaveCount(count); // the old keys do nothing now
  await press(page, "ControlOrMeta+Alt+j");
  await expect(tabs(page)).toHaveCount(count + 1);

  // A second combo, then reset to the default
  await openShortcutSettings(page);
  await row.getByTestId("shortcut-add").click();
  await press(page, "F8");
  await expect(row.getByTestId("shortcut-keys")).toHaveCount(2);
  await row.getByTestId("shortcut-reset").click();
  await expect(row.getByTestId("shortcut-keys")).toHaveCount(1);
  await expect(row.getByTestId("shortcut-keys")).toHaveText(/^(⌘N|Ctrl\+N)$/);

  // Removing the only combo leaves none; the overview says so
  await row.getByTestId("shortcut-keys").hover();
  await row.getByRole("button", { name: /^Remove / }).click();
  await expect(row.getByTestId("shortcut-keys")).toHaveCount(0);
  await expect(row.getByTestId("shortcut-add")).toHaveText("None · add");
});

test("a plugin's shortcut is listed under its name while enabled (Meeting recordings)", async ({ page }) => {
  await page.goto("/");
  await openShortcutSettings(page);
  await expect(page.getByTestId("shortcut-meetings:record")).toHaveCount(0);
  await enablePlugin(page, "meetings");
  await openShortcutSettings(page);
  await expect(page.getByTestId("shortcuts-settings")).toContainText("Meeting recordings");
  await expect(page.getByTestId("shortcut-meetings:record")).toContainText("Start or stop recording");
  // Without the speech model it says what's missing
  await press(page, "ControlOrMeta+Shift+r");
  await expect(page.getByTestId("notice").filter({ hasText: "Can't record yet" })).toBeVisible();
});
