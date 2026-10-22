import { test, expect } from "@playwright/test";
import { enablePlugin } from "./plugins";

test("plugins page: built-in plugins as cards, enabled ones apart from disabled ones, details in the panel", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-plugins").click();
  const disabled = page.getByTestId("plugins-disabled");
  await expect(page.getByTestId("plugins-enabled")).toContainText("No plugins enabled yet");
  for (const id of ["meetings", "writing", "jira"]) await expect(disabled.getByTestId(`plugin-card-${id}`)).toBeVisible();
  await expect(page.getByTestId("plugin-card-jira")).toContainText("Forgor · v1.0.0 · Built-in");
  await expect(page.getByTestId("plugin-needs-meetings")).toContainText("Speech recognition");
  await expect(page.getByTestId("plugin-needs-meetings")).toContainText("Language model (optional)");
  await expect(page.getByTestId("plugin-needs-jira")).toContainText("nothing else");

  // The panel: what it needs; settings only once enabled
  await page.getByTestId("plugin-card-meetings").click();
  const panel = page.getByTestId("plugin-panel");
  await expect(panel).toContainText("Meeting recordings");
  await expect(panel).toContainText("No other plugins");
  await expect(panel.getByTestId("needs-speech")).toContainText("For recording and the transcript");
  await expect(panel).toContainText("Enable the plugin to change its settings.");
  await panel.getByTestId("plugin-enabled").click();
  await expect(page.getByTestId("plugins-enabled").getByTestId("plugin-card-meetings")).toBeVisible();
  await expect(panel.getByTestId("plugin-settings")).toContainText("Microphone");
  await expect(page.getByTestId("nav-meetings")).toBeVisible();

  // Settings has no feature sections anymore, only the shared AI models
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("ai-models")).toBeVisible();
  await expect(page.getByTestId("main")).not.toContainText("Meeting recordings");
});

test("disabling a plugin hides it but keeps its data; its page says it is disabled", async ({ page }) => {
  await page.goto("/");
  await enablePlugin(page, "jira");
  const dialogOpen = page.getByTestId("jira-connect");
  await dialogOpen.click();
  const dialog = page.getByTestId("jira-connect-dialog");
  await dialog.getByLabel("Jira address").fill("acme");
  await dialog.getByLabel("Email").fill("demo@example.com");
  await dialog.getByLabel("API token").fill("secret-token");
  await dialog.getByTestId("jira-connect-submit").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");

  // Link a board to a folder
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  const folder = page.getByTestId("folder-panel");
  await folder.getByTestId("jira-link-board").click();
  await page.getByTestId("jira-board-picker").getByLabel("Search boards").fill("web");
  await page.getByTestId("jira-board-option").click();
  await expect(folder.getByTestId("jira-board-chip")).toHaveCount(1);
  await page.getByTestId("nav-jira").click();

  // Off: gone from the sidebar and the folder; the open Jira tab says why
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-toggle-jira").click();
  await expect(page.getByTestId("plugins-disabled").getByTestId("plugin-card-jira")).toBeVisible();
  await expect(page.getByTestId("nav-jira")).toHaveCount(0);
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await expect(page.getByTestId("folder-panel")).not.toContainText("Jira");
  await page.getByTestId("nav-back").click(); // back to the Jira page (pages share one tab)
  await expect(page.getByTestId("plugin-unavailable")).toContainText("Jira is disabled");

  // On again: account and linked board are still there
  await page.getByTestId("plugin-unavailable").getByRole("button", { name: "Open in Plugins" }).click();
  await page.getByTestId("plugin-panel").getByTestId("plugin-enabled").click();
  await expect(page.getByTestId("jira-account")).toContainText("Demo User");
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await expect(page.getByTestId("folder-panel").getByTestId("jira-board-chip")).toHaveCount(1);
});

test("community plugins: install from a folder, a broken one shows why, uninstall", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible(); // started
  type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }> } };
  const manifest = (id: string) => JSON.stringify({ id, name: `Hello ${id}`, version: "0.1.0", author: "Someone", description: "Says hello." });

  // A plugin written by hand (no build step): a page and a sidebar item, using the app's React
  const main = `
    const React = require("react");
    module.exports = (api) => ({
      sidebar: () => React.createElement(api.ui.NavItem, { label: "Hello", icon: () => null, target: { kind: "plugin", plugin: api.id, page: "hi" }, testId: "nav-hello" }),
      pages: { hi: { useTab: () => ({ label: "Hello", icon: () => null }), component: () => {
        const [n, setN] = React.useState(0);
        return React.createElement("button", { "data-testid": "hello-button", onClick: () => setN(n + 1) }, "Clicked " + n);
      } } },
    });`;
  await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest("hello"), main]);
  await page.getByTestId("nav-plugins").click();
  const card = page.getByTestId("plugins-enabled").getByTestId("plugin-card-hello");
  await expect(card).toContainText("Someone · v0.1.0 · Community");
  await page.getByTestId("nav-hello").click();
  await page.getByTestId("hello-button").click();
  await expect(page.getByTestId("hello-button")).toHaveText("Clicked 1");

  // Broken: listed with the reason, can't be enabled
  const result = await page.evaluate(([m]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": "throw new Error('oops')" }), [manifest("broken")]);
  expect(result.error).toBe("oops");
  await page.getByTestId("nav-plugins").click();
  await expect(page.getByTestId("plugin-card-broken").getByTestId("plugin-error")).toContainText("oops");
  await expect(page.getByTestId("plugin-toggle-broken")).toBeDisabled();

  // Uninstall
  await page.getByTestId("plugin-card-hello").click();
  await page.getByTestId("uninstall-plugin").click();
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Uninstall" }).click();
  await expect(page.getByTestId("plugin-card-hello")).toHaveCount(0);
  await expect(page.getByTestId("nav-hello")).toHaveCount(0);
});

test("a community plugin's query runs on the app's client: a sidebar count and the same data from fetchQuery", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }> } };
  const manifest = JSON.stringify({ id: "counter", name: "Counter", version: "0.1.0", author: "Someone", description: "Counts." });
  // The recipe in the template's AGENTS.md, by hand: one query for the count and for a check outside React
  const main = `
    const React = require("react");
    let calls = 0;
    const itemsQuery = { queryKey: ["counter", "items"], queryFn: async () => { calls++; return [{ id: "a" }, { id: "b" }, { id: "c" }]; }, staleTime: 60000 };
    module.exports = (api) => ({
      remoteQueries: ["counter"],
      sidebar: () => {
        const { data } = api.app.useQuery(itemsQuery);
        return React.createElement(api.ui.NavItem, { label: "Counter", icon: () => null, count: data && data.length, target: { kind: "plugin", plugin: api.id, page: "main" }, testId: "nav-counter" });
      },
      pages: { main: { useTab: () => ({ label: "Counter", icon: () => null }), component: () => {
        const [text, setText] = React.useState("");
        return React.createElement("button", { "data-testid": "counter-fetch", onClick: async () => {
          const items = await api.app.queryClient.fetchQuery(itemsQuery);
          setText(items.length + " items, " + calls + " request");
        } }, text || "Fetch");
      } } },
    });`;
  const r = await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest, main]);
  expect(r.error).toBeUndefined();
  await expect(page.getByTestId("nav-counter")).toContainText("3");
  await page.getByTestId("nav-counter").click();
  await page.getByTestId("counter-fetch").click();
  await expect(page.getByTestId("counter-fetch")).toHaveText("3 items, 1 request"); // from the shared cache
});
