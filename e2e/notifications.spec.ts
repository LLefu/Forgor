import { test, expect, type Page } from "@playwright/test";
import { enablePlugin } from "./plugins";

// The browser build keeps notifications in a list (platform/notifications.ts) and lets the test make
// things happen on the fake Jira and Bitbucket, then run the checks right away (normally every 5 minutes).
type Wn = {
  __wn: {
    notifications: { sent(): { title: string; body: string }[]; played(): string[]; check(): Promise<void> };
    fakeJira: { assign(key: string, summary: string): void; comment(key: string, author: string, text: string): void };
    fakeBitbucket: { requestReview(repo: string, id: number, title: string): void };
  };
};
const sent = (page: Page) => page.evaluate(() => (window as unknown as Wn).__wn.notifications.sent().map((n) => n.title));
const played = (page: Page) => page.evaluate(() => (window as unknown as Wn).__wn.notifications.played());
const check = (page: Page) => page.evaluate(() => (window as unknown as Wn).__wn.notifications.check());

async function setUp(page: Page) {
  await page.goto("/");
  await enablePlugin(page, "jira");
  await page.getByTestId("jira-connect").click();
  const jira = page.getByTestId("jira-connect-dialog");
  await jira.getByLabel("Jira address").fill("acme");
  await jira.getByLabel("Email").fill("demo@example.com");
  await jira.getByLabel("API token").fill("secret-token");
  await jira.getByTestId("jira-connect-submit").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");

  await enablePlugin(page, "bitbucket");
  await page.getByTestId("bitbucket-connect").click();
  const bb = page.getByTestId("bitbucket-connect-dialog");
  await bb.getByLabel("API token").fill("secret-token");
  await bb.getByTestId("bitbucket-connect-submit").click();
  await expect(page.getByTestId("bitbucket-account")).toContainText("Demo User");

  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  const section = page.getByTestId("folder-bitbucket");
  await section.getByTestId("bitbucket-link-repo").click();
  await section.getByLabel("Search repositories").fill("Mobile app");
  await section.getByTestId("bitbucket-repo-option").click();
  await expect(section.getByTestId("bitbucket-repo-chip")).toHaveCount(1);
}

test("new review requests, assigned tickets and comments notify once; the first check only takes stock", async ({ page }) => {
  await setUp(page);
  await check(page);
  expect(await sent(page)).toEqual([]); // what's already there doesn't notify

  await page.evaluate(() => {
    const w = (window as unknown as Wn).__wn;
    w.fakeBitbucket.requestReview("acme/mobile-app", 50, "Dark mode for settings");
    w.fakeJira.assign("WEB-20", "Fix the footer links");
    w.fakeJira.comment("WEB-12", "Sanne de Vries", "Can you check this on iOS too?");
    w.fakeJira.comment("WEB-15", "Demo User", "My own comment"); // never notifies
  });
  await check(page);
  expect((await sent(page)).sort()).toEqual(["Assigned to you: WEB-20", "Lisa Jansen asked you to review", "Sanne de Vries commented on WEB-12"].sort());
  const bodies = await page.evaluate(() => (window as unknown as Wn).__wn.notifications.sent().map((n) => n.body));
  expect(bodies).toContain("Dark mode for settings (Mobile app #50)");
  expect(bodies).toContain("Can you check this on iOS too?");

  expect(await played(page)).toEqual(["chime"]); // one sound for the whole burst, not one per notification

  await check(page);
  expect(await sent(page)).toHaveLength(3); // nothing twice
  expect(await played(page)).toHaveLength(1);
});

test("the bell keeps a history: unread dot, newest first, a click opens the ticket or the PR", async ({ page }) => {
  await setUp(page);
  const bell = page.getByTestId("notifications-button");
  await expect(bell).toHaveAttribute("data-unread", "false");
  await check(page);
  await page.evaluate(() => {
    const w = (window as unknown as Wn).__wn;
    w.fakeBitbucket.requestReview("acme/mobile-app", 60, "Offline mode");
    w.fakeJira.comment("WEB-12", "Sanne de Vries", "Looks good to me");
  });
  await check(page);
  await expect(page.getByTestId("notifications-unread")).toBeVisible();

  // The menu lists them; opening it marks them read
  await bell.click();
  const menu = page.getByTestId("notifications-menu");
  await expect(menu.getByTestId("notification-entry")).toHaveCount(2);
  await expect(menu).toContainText("Lisa Jansen asked you to review");
  await expect(menu).toContainText("Offline mode (Mobile app #60)");
  await expect(menu).toContainText("Sanne de Vries commented on WEB-12");
  await expect(bell).toHaveAttribute("data-unread", "false");

  // A comment opens the Jira overview with that ticket's panel
  await menu.getByTestId("notification-entry").filter({ hasText: "commented on WEB-12" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("jira-page")).toBeVisible();
  await expect(page.getByTestId("issue-panel").getByTestId("issue-summary")).toHaveText("Homepage hero loads slowly on mobile");

  // A review request opens Pull requests with the PR's panel
  await bell.click();
  await menu.getByTestId("notification-entry").filter({ hasText: "asked you to review" }).click();
  await expect(page.getByTestId("pr-page")).toBeVisible();
  await expect(page.getByTestId("pr-panel").getByTestId("pr-title")).toHaveText("Offline mode");

  // Cleared (it's kept in the database; the browser build's is in memory, so no reload here)
  await bell.click();
  await expect(menu.getByTestId("notification-entry")).toHaveCount(2);
  await page.getByTestId("notifications-clear").click();
  await expect(page.getByTestId("notifications-menu")).toContainText("No notifications yet.");
});

test("the notification sound: chosen in Settings (it plays as a preview), or none", async ({ page }) => {
  await setUp(page);
  await check(page);
  await page.getByTestId("nav-settings").click();
  await page.getByLabel("Notification sound").selectOption("ping");
  expect(await played(page)).toEqual(["ping"]); // the preview
  await page.getByTestId("notifications-play-sound").click();
  expect(await played(page)).toEqual(["ping", "ping"]);

  await page.waitForTimeout(3100); // a burst makes one sound (at most one per 3 s)
  await page.evaluate(() => (window as unknown as Wn).__wn.fakeJira.assign("WEB-30", "With ping"));
  await check(page);
  expect(await played(page)).toEqual(["ping", "ping", "ping"]);

  // The test notification waits 5 s (to switch apps); with Forgor in front it also shows inside the app
  await page.getByTestId("notifications-test").click();
  await expect(page.getByTestId("notifications-test-waiting")).toContainText("arrives in 5 seconds");
  await expect.poll(() => sent(page), { timeout: 8000 }).toContain("Forgor");
  await expect(page.getByTestId("notice").filter({ hasText: "Notifications work." })).toBeVisible();
  expect(await played(page)).toEqual(["ping", "ping", "ping", "ping"]);

  await page.getByLabel("Notification sound").selectOption("none");
  await expect(page.getByTestId("notifications-play-sound")).toBeDisabled();
  await page.evaluate(() => (window as unknown as Wn).__wn.fakeJira.assign("WEB-31", "Silent"));
  await check(page);
  expect(await sent(page)).toEqual(["Assigned to you: WEB-30", "Forgor", "Assigned to you: WEB-31"]);
  expect(await played(page)).toHaveLength(4);
});

test("a kind can be switched off in the plugin's panel, and all of them in Settings", async ({ page }) => {
  await setUp(page);
  await check(page);

  // Bitbucket's review requests off
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-card-bitbucket").click();
  await page.getByTestId("plugin-notifications").getByTestId("notify-bitbucket-review").click();
  await page.evaluate(() => {
    const w = (window as unknown as Wn).__wn;
    w.fakeBitbucket.requestReview("acme/mobile-app", 51, "Muted one");
    w.fakeJira.assign("WEB-21", "Still notifies");
  });
  await check(page);
  expect(await sent(page)).toEqual(["Assigned to you: WEB-21"]);

  // Everything off in Settings
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("notifications-enabled").click();
  await page.evaluate(() => (window as unknown as Wn).__wn.fakeJira.assign("WEB-22", "Silent"));
  await check(page);
  expect(await sent(page)).toEqual(["Assigned to you: WEB-21"]);

  // The plugin's panel says so
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-card-jira").click();
  await expect(page.getByTestId("plugin-notifications")).toContainText("Notifications are off for all of Forgor");
});
