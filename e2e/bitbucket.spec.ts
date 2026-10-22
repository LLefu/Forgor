import { test, expect, type Page } from "@playwright/test";
import { enablePlugin } from "./plugins";

// The browser build talks to a fake Bitbucket (src/platform/bitbucket.ts). Workspaces acme and side-projects;
// open PRs: website #42 and blog #7 (mine), mobile-app #17 and #18 (draft, already approved by me, so never listed) to review;
// website #43 (someone else's) and #40 (merged) must never show. The token "wrong" is rejected.

async function connect(page: Page) {
  await enablePlugin(page, "bitbucket");
  await page.getByTestId("bitbucket-connect").click();
  const dialog = page.getByTestId("bitbucket-connect-dialog");
  await dialog.getByLabel("Email").fill("demo@example.com");
  await dialog.getByLabel("API token").fill("wrong");
  await dialog.getByTestId("bitbucket-connect-submit").click();
  await expect(dialog.getByTestId("bitbucket-connect-error")).toContainText("didn't accept");
  await dialog.getByLabel("API token").fill("secret-token");
  await dialog.getByTestId("bitbucket-connect-submit").click();
  await expect(page.getByTestId("bitbucket-account")).toContainText("Demo User");
}

const refs = (page: Page, group: string) => page.getByTestId(group).getByTestId("pr-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-ref")));

async function linkRepo(page: Page, name: string) {
  const section = page.getByTestId("folder-panel").getByTestId("folder-bitbucket");
  await section.getByTestId("bitbucket-link-repo").click();
  await section.getByTestId("bitbucket-repo-picker").getByLabel("Search repositories").fill(name);
  await expect(section.getByTestId("bitbucket-repo-option")).toHaveCount(1);
  await section.getByTestId("bitbucket-repo-option").click();
  await expect(section.getByTestId("bitbucket-repo-chip").filter({ hasText: name })).toBeVisible();
}

test("Bitbucket is off until turned on; then Pull requests sits under Jira in the sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-pull-requests")).toHaveCount(0);
  await enablePlugin(page, "jira");
  await connect(page);
  const order = await page.locator('[data-testid="nav-jira"], [data-testid="nav-pull-requests"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(order).toEqual(["nav-jira", "nav-pull-requests"]);
});

test("overview: my open PRs everywhere; review requests from linked repositories, marked differently", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await connect(page);

  // Nothing linked yet: only mine (Bitbucket lists those per user), and a hint
  await page.getByTestId("nav-pull-requests").click();
  await expect.poll(() => refs(page, "pr-group-mine")).toEqual(["acme/website/42", "side-projects/blog/7"]);
  await expect(page.getByTestId("pr-group-review")).toContainText("Nobody is waiting for your review.");
  await expect(page.getByTestId("pr-page")).toContainText("Review requests come from repositories linked to a folder");

  // Link the app's repository to a folder: its review requests appear (not someone else's, not merged ones)
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await linkRepo(page, "Mobile app");
  await linkRepo(page, "Website");
  const section = page.getByTestId("folder-bitbucket");
  await expect.poll(() => section.getByTestId("pr-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-ref")))).toEqual([
    "acme/mobile-app/17",
    "acme/website/42",
  ]);

  await page.getByTestId("nav-pull-requests").click();
  await expect.poll(() => refs(page, "pr-group-review")).toEqual(["acme/mobile-app/17"]); // not #18: I approved it
  await expect.poll(() => refs(page, "pr-group-mine")).toEqual(["acme/website/42", "side-projects/blog/7"]);
  await expect(page.getByTestId("pr-list")).not.toContainText("Cookie banner");
  await expect(page.getByTestId("pr-list")).not.toContainText("Analytics setup");
  const list = page.getByTestId("pr-list");
  const review = list.locator('[data-ref="acme/mobile-app/17"]');
  await expect(review).toHaveAttribute("data-role", "review");
  await expect(review.getByTestId("pr-review-chip")).toHaveText("Review");
  await expect(list.locator('[data-ref="acme/website/42"]').getByTestId("pr-approvals")).toHaveText("1/2");

  // Build status on the rows (summed up: a running build beats a passed one)
  await expect(list.locator('[data-ref="acme/website/42"]').getByTestId("pr-build")).toHaveAttribute("data-build", "running");
  await expect(review.getByTestId("pr-build")).toHaveAttribute("data-build", "failed");

  // The sidebar counts review requests still waiting for me (#17; #18 I already approved)
  await expect(page.getByTestId("nav-pull-requests")).toContainText("1");

  // The Review tag opens the PR in Bitbucket (not the panel)
  const popup = page.waitForEvent("popup");
  await review.getByTestId("pr-review-chip").click();
  expect((await popup).url()).toBe("https://bitbucket.org/acme/mobile-app/pull-requests/17");
  await expect(page.getByTestId("pr-panel")).toHaveCount(0);

  // The filter: Review requested hides mine (and back)
  await page.getByTestId("pr-filter-review").click();
  await expect(page.getByTestId("pr-filter-review")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("pr-group-mine")).toHaveAttribute("data-shown", "false");
  await expect(page.getByTestId("pr-group-review")).toHaveAttribute("data-shown", "true");
  await page.getByTestId("pr-filter-mine").click();
  await expect(page.getByTestId("pr-group-review")).toHaveAttribute("data-shown", "false");
  await page.getByTestId("pr-filter-all").click();
  await page.getByLabel("Search pull requests").fill("skip");
  await expect.poll(() => refs(page, "pr-group-review")).toEqual(["acme/mobile-app/17"]);
  await expect.poll(() => refs(page, "pr-group-mine")).toEqual([]);
  expect(errors).toEqual([]);
});

test("Today: numbers and lists from Jira and Bitbucket, only while connected", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByTestId("nav-today").click();
  const cards = page.getByTestId("today-cards");
  await expect(cards.getByRole("button")).toHaveCount(1); // only todos
  await expect(page.getByTestId("nav-today")).not.toContainText(/\d/); // no count in the sidebar
  await expect(page.getByTestId("today-without-folder")).toBeVisible();

  await enablePlugin(page, "jira");
  await page.getByTestId("jira-connect").click();
  const jira = page.getByTestId("jira-connect-dialog");
  await jira.getByLabel("Jira address").fill("acme");
  await jira.getByLabel("Email").fill("demo@example.com");
  await jira.getByLabel("API token").fill("secret-token");
  await jira.getByTestId("jira-connect-submit").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");
  await connect(page);
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await linkRepo(page, "Mobile app");

  await page.getByTestId("nav-today").click();
  await expect(page.getByTestId("today-card-jira").getByTestId("today-card-count")).toHaveText("5");
  await expect(page.getByTestId("today-card-my-prs").getByTestId("today-card-count")).toHaveText("2");
  await expect(page.getByTestId("today-card-reviews").getByTestId("today-card-count")).toHaveText("1"); // #18 is already approved
  await expect.poll(() => refs(page, "today-reviews")).toEqual(["acme/mobile-app/17"]);
  await expect(page.getByTestId("today-failed-builds")).toHaveCount(0); // mine: running / none
  await expect(page.getByTestId("today-jira").getByTestId("issue-row").first()).toBeVisible();

  // A card opens its page
  await page.getByTestId("today-card-reviews").click();
  await expect(page.getByTestId("pr-page")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the detail panel: branches, reviewers, comments, files changed, a short description, the ticket, open in Bitbucket", async ({ page }) => {
  await page.goto("/");
  await enablePlugin(page, "jira");
  await page.getByTestId("jira-connect").click();
  const jira = page.getByTestId("jira-connect-dialog");
  await jira.getByLabel("Jira address").fill("acme");
  await jira.getByLabel("Email").fill("demo@example.com");
  await jira.getByLabel("API token").fill("secret-token");
  await jira.getByTestId("jira-connect-submit").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");
  await connect(page);
  await page.getByTestId("nav-pull-requests").click();
  await page.locator('[data-ref="acme/website/42"]').click();
  const panel = page.getByTestId("pr-panel");
  await expect(panel.getByTestId("pr-title")).toHaveText("WEB-12 Faster hero image on mobile");
  await expect(panel.getByTestId("pr-branches")).toContainText("feature/WEB-12-hero-image");
  await expect(panel.getByTestId("pr-branches")).toContainText("main");
  await expect(panel.getByTestId("pr-reviewers").locator("li")).toHaveCount(2);
  await expect(panel.locator('[data-state="approved"]')).toContainText("Sanne de Vries");
  await expect(panel.locator('[data-state="waiting"]')).toContainText("Joost Bakker");
  await expect(panel.getByTestId("pr-comments")).toHaveText("3");
  await expect(panel.getByTestId("pr-files")).toHaveText("3 files +128 −46");
  await expect(panel.getByTestId("open-in-bitbucket")).toBeVisible();
  await expect(panel.getByTestId("pr-builds").locator("li")).toHaveCount(2);
  await expect(panel.getByTestId("pr-builds")).toContainText("Pipeline #311");

  // The description is cut off with "Show more"; markdown markers are gone
  const description = panel.getByTestId("pr-description");
  await expect(description).toContainText("The hero image was loaded at full size");
  await expect(description).not.toContainText("##");
  const height = () => description.locator("div").first().evaluate((el) => el.clientHeight);
  const short = await height();
  await panel.getByTestId("pr-description-toggle").click();
  await expect(panel.getByTestId("pr-description-toggle")).toHaveText("Show less");
  expect(await height()).toBeGreaterThan(short);

  // The ticket opens in the Jira panel
  await panel.getByTestId("pr-tickets").getByRole("button", { name: "WEB-12" }).click();
  await expect(page.getByTestId("issue-panel").getByTestId("issue-summary")).toHaveText("Homepage hero loads slowly on mobile");
});
