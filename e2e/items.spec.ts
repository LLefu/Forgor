import { test, expect, type Page } from "@playwright/test";
import { enablePlugin } from "./plugins";

// The items API: Jira and Bitbucket share their tickets and pull requests with other plugins (api.app.useItems).
// A community plugin shows them on a page, the way an overview would. Fake Jira: my open tickets WEB-12 (3 h left,
// due 2026-10-20), WEB-15, WEB-9, APP-41 (30 min), APP-38. Fake Bitbucket: website #42 and blog #7 (mine), mobile-app #17 (to review).

type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }> } };

const main = `const React = require("react");
const h = React.createElement;
module.exports = (api) => ({
  requires: ["jira", "bitbucket"],
  sidebar: () => h(api.ui.NavItem, { label: "Overview", icon: () => null, target: { kind: "plugin", plugin: api.id, page: "all" }, testId: "nav-overview" }),
  pages: {
    all: {
      useTab: () => ({ label: "Overview", icon: () => null }),
      component: () => {
        const { items, errors, isLoading } = api.app.useItems();
        if (isLoading) return h("p", null, "Loading");
        return h("div", { "data-testid": "overview" },
          errors.map((e) => h("p", { key: e.source, "data-testid": "overview-error" }, e.sourceName + ": " + e.message)),
          [...items].sort((a, b) => a.key.localeCompare(b.key)).map((i) => h("button", {
            key: i.source + i.id, "data-testid": "overview-item", "data-source": i.source, "data-folder": i.folderId ?? "",
            onClick: i.open,
          }, [i.key, i.kind, i.status, i.dueDate ?? "-", i.estimateMin ?? "-", i.url ? "url" : "-"].join(" | "))));
      },
    },
  },
});`;

async function connectJira(page: Page) {
  await enablePlugin(page, "jira");
  await page.getByTestId("jira-connect").click();
  const dialog = page.getByTestId("jira-connect-dialog");
  await dialog.getByLabel("Jira address").fill("acme");
  await dialog.getByLabel("Email").fill("demo@example.com");
  await dialog.getByLabel("API token").fill("secret-token");
  await dialog.getByTestId("jira-connect-submit").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");
}

async function connectBitbucket(page: Page) {
  await enablePlugin(page, "bitbucket");
  await page.getByTestId("bitbucket-connect").click();
  const dialog = page.getByTestId("bitbucket-connect-dialog");
  await dialog.getByLabel("Email").fill("demo@example.com");
  await dialog.getByLabel("API token").fill("secret-token");
  await dialog.getByTestId("bitbucket-connect-submit").click();
  await expect(page.getByTestId("bitbucket-account")).toContainText("Demo User");
}

test("a plugin gets Jira tickets and pull requests as one list, with folders, and opens them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await connectJira(page);
  await connectBitbucket(page);

  // Link the WEB board to a folder: its tickets then carry that folder
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  const section = page.getByTestId("folder-panel").getByTestId("folder-jira");
  await section.getByTestId("jira-link-board").click();
  await page.waitForTimeout(300); // the list stays open
  await section.getByTestId("jira-board-picker").getByLabel("Search boards").fill("web");
  await section.getByTestId("jira-board-option").click();
  await expect(section.getByTestId("jira-board-chip")).toHaveText(["WEB board"]);
  // and a repository: review requests only come from linked repositories
  const repos = page.getByTestId("folder-panel").getByTestId("folder-bitbucket");
  await repos.getByTestId("bitbucket-link-repo").click();
  await repos.getByTestId("bitbucket-repo-picker").getByLabel("Search repositories").fill("mobile");
  await expect(repos.getByTestId("bitbucket-repo-option")).toHaveCount(1);
  await repos.getByTestId("bitbucket-repo-option").click();
  await expect(repos.getByTestId("bitbucket-repo-chip").filter({ hasText: "mobile" })).toBeVisible();

  const manifest = JSON.stringify({ id: "overview", name: "Overview", version: "0.1.0", author: "Test", description: "Everything.", requires: ["jira", "bitbucket"] });
  const r = await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest, main]);
  expect(r.error).toBeUndefined();
  await page.getByTestId("nav-overview").click();

  const rows = page.getByTestId("overview-item");
  await expect(rows).toHaveText([
    "APP-38 | Jira ticket | In Progress | - | - | url",
    "APP-41 | Jira ticket | To Do | 2026-10-14 | 30 | url",
    "WEB-12 | Jira ticket | In Progress | 2026-10-20 | 180 | url",
    "WEB-15 | Jira ticket | To Do | - | - | url",
    "WEB-9 | Jira ticket | In Review | 2026-10-15 | - | url",
    "blog#7 | Pull request | Open | - | - | url",
    "mobile-app#17 | Pull request | Review requested | - | - | url",
    "website#42 | Pull request | Open | - | - | url",
  ].sort((a, b) => a.localeCompare(b)));
  await expect(page.getByTestId("overview-error")).toHaveCount(0);

  // Folders: WEB tickets are in the folder the WEB board is linked to, APP tickets in none
  const folderOf = (key: string) => rows.filter({ hasText: key }).getAttribute("data-folder");
  const acme = await folderOf("WEB-12");
  expect(acme).not.toBe("");
  expect(await folderOf("WEB-9")).toBe(acme);
  expect(await folderOf("APP-41")).toBe("");
  expect(await folderOf("mobile-app#17")).toBe(acme);
  expect(await folderOf("blog#7")).toBe("");

  // open() shows the item in the app
  await rows.filter({ hasText: "WEB-12" }).click();
  await expect(page.getByTestId("issue-panel")).toContainText("Homepage hero loads slowly on mobile");
  expect(errors).toEqual([]);
});
