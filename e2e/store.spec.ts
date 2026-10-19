import { test, expect, type Page } from "@playwright/test";

// The browser build talks to an in-memory fake store (src/platform/store.ts `fakeStore`), which starts empty.

type Files = Record<string, string>;
type Wn = {
  __wn: {
    installPlugin(files: Files): Promise<unknown>;
    store: { publish(zip: Uint8Array, key: string | null): Promise<unknown>; remove(id: string, reason: string): void };
  };
};

const plugin = (version: string): Files => ({
  "manifest.json": JSON.stringify({ id: "hello", name: "Hello", version, author: "Someone", description: "Says hello from the store." }),
  "main.js": `const React = require("react");
module.exports = (api) => ({ pages: { hi: { useTab: () => ({ label: "Hello", icon: () => null }), component: () => React.createElement("p", { "data-testid": "hello-page" }, "Hello ${version}") } } });`,
});

async function start(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible(); // started
}

test("store: publish a plugin, it shows in the store, a new version needs the key, report it", async ({ page }) => {
  await start(page);
  await page.evaluate((files) => (window as unknown as Wn).__wn.installPlugin(files), plugin("0.1.0"));

  // Publish from its panel
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-installed").click();
  await page.getByTestId("plugin-card-hello").click();
  const panel = page.getByTestId("plugin-panel");
  await expect(panel).toContainText("Not in the store yet");
  await panel.getByTestId("publish-plugin").click();
  const dialog = page.getByTestId("publish-dialog");
  await dialog.getByTestId("publish-confirm").click();
  await expect(dialog).toContainText("Hello v0.1.0 is in the store");
  await expect(dialog.getByTestId("publish-key")).toHaveValue(/^fpk_/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(panel).toContainText("The store has v0.1.0. Raise the version");
  await expect(panel.getByTestId("publish-plugin")).toBeDisabled();

  // In the store, installed already
  await page.getByTestId("plugins-tab-store").click();
  const card = page.getByTestId("store-card-hello");
  await expect(card).toContainText("Someone · v0.1.0");
  await expect(card.getByTestId("store-installed")).toBeVisible();
  await page.getByTestId("store-search").fill("nothing like it");
  await expect(page.getByTestId("store-empty")).toContainText("No plugins match");
  await page.getByTestId("store-search").fill("hello");
  await expect(card).toBeVisible();

  // A new version: the key from this computer is used
  await page.evaluate((files) => (window as unknown as Wn).__wn.installPlugin(files), plugin("0.2.0"));
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-installed").click();
  await page.getByTestId("plugin-card-hello").click();
  await panel.getByTestId("publish-plugin").click();
  await expect(dialog).toContainText("The store has v0.1.0");
  await dialog.getByTestId("publish-confirm").click();
  await expect(dialog).toContainText("Hello v0.2.0 is in the store");
  await expect(dialog.getByTestId("publish-key")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();

  // Report it
  await page.getByTestId("plugins-tab-store").click();
  await card.getByRole("button", { name: "Report Hello" }).click();
  const report = page.getByTestId("report-dialog");
  await report.getByLabel("Reason").fill("It only says hello");
  await report.getByTestId("report-send").click();
  await expect(report).toContainText("Thanks");
});

test("store: install from the store, get an update, and a plugin taken out of the store is turned off", async ({ page }) => {
  await start(page);
  type Publish = { __wn: { publishToStore(files: Files, key: string | null): Promise<{ publishKey?: string }> } };
  // Someone else published it
  const { publishKey } = await page.evaluate((files) => (window as unknown as Publish).__wn.publishToStore(files, null), plugin("1.0.0"));

  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-store").click();
  const card = page.getByTestId("store-card-hello");
  await expect(card).toContainText("0 installs");
  // Not checked by Forgor: a warning first (cancel installs nothing)
  await card.getByTestId("store-install-hello").click();
  const warning = page.getByTestId("confirm-dialog");
  await expect(warning).toContainText("Install Hello?");
  await expect(warning).toContainText("Forgor hasn't checked this plugin.");
  await expect(warning).toContainText("anyone can type any name there");
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByTestId("store-install-hello")).toHaveText(/Install/);
  await card.getByTestId("store-install-hello").click();
  await warning.getByRole("button", { name: "Install" }).click();
  await expect(page.getByTestId("plugin-panel")).toContainText("Hello");
  await expect(card.getByTestId("store-installed")).toBeVisible();
  await expect(card).toContainText("1 install");

  // They publish a new version: it's offered on the installed card
  await page.evaluate(([files, key]) => (window as unknown as Publish).__wn.publishToStore(files as Files, key as string), [plugin("1.1.0"), publishKey!] as const);
  await page.getByTestId("store").getByRole("button", { name: "Refresh the store" }).click();
  await expect(card.getByTestId("store-install-hello")).toHaveText(/Update to v1.1.0/);
  await page.getByTestId("plugins-tab-installed").click();
  await page.getByTestId("plugin-update-hello").click();
  await expect(page.getByTestId("plugin-card-hello")).toContainText("v1.1.0");
  await expect(page.getByTestId("plugin-update-hello")).toHaveCount(0);

  // Taken out of the store: turned off here, with the reason
  await expect(page.getByTestId("plugins-enabled").getByTestId("plugin-card-hello")).toBeVisible();
  await page.evaluate(() => (window as unknown as Wn).__wn.store.remove("hello", "It sends your notes somewhere"));
  await page.getByTestId("plugins-tab-store").click();
  await page.getByTestId("store").getByRole("button", { name: "Refresh the store" }).click();
  await expect(page.getByTestId("store-card-hello")).toHaveCount(0);
  await expect(page.getByTestId("toasts")).toContainText("Hello was taken out of the plugin store and has been turned off. Reason: It sends your notes somewhere");
  await page.getByTestId("plugins-tab-installed").click();
  const installed = page.getByTestId("plugins-disabled").getByTestId("plugin-card-hello");
  await expect(installed.getByTestId("plugin-removed")).toContainText("It sends your notes somewhere");
});

test("install from a zip file", async ({ page }) => {
  await start(page);
  const { zipSync, strToU8 } = await import("fflate");
  const zip = zipSync({ "hello/manifest.json": strToU8(plugin("2.0.0")["manifest.json"]), "hello/main.js": strToU8(plugin("2.0.0")["main.js"]) });
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-installed").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("install-plugin-zip").click();
  await (await chooser).setFiles({ name: "hello.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  const warning = page.getByTestId("confirm-dialog");
  await expect(warning).toContainText("comes from a zip file");
  await warning.getByRole("button", { name: "Install" }).click();
  await expect(page.getByTestId("plugins-enabled").getByTestId("plugin-card-hello")).toContainText("v2.0.0 · Community");
});

test("plugins with the check mark install without a warning", async ({ page }) => {
  await start(page);
  type Store = { __wn: { publishToStore(files: Files, key: string | null): Promise<unknown>; store: { verify(id: string): void } } };
  await page.evaluate(async (files) => {
    const wn = (window as unknown as Store).__wn;
    await wn.publishToStore(files, null);
    wn.store.verify("hello");
  }, plugin("1.0.0"));
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-store").click();
  await page.getByTestId("store").getByRole("button", { name: "Refresh the store" }).click();
  const card = page.getByTestId("store-card-hello");
  await expect(card.getByLabel("Verified")).toBeVisible();
  await card.getByTestId("store-install-hello").click();
  await expect(card.getByTestId("store-installed")).toBeVisible();
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
});

test("update an installed plugin from a zip in its panel", async ({ page }) => {
  await start(page);
  await page.evaluate((files) => (window as unknown as Wn).__wn.installPlugin(files), plugin("1.0.0"));
  const { zipSync, strToU8 } = await import("fflate");
  const zipOf = (files: Files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, c]) => [n, strToU8(c)]))));
  const pick = async (buffer: Buffer) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("plugin-panel").getByTestId("update-from-zip").click();
    await (await chooser).setFiles({ name: "plugin.zip", mimeType: "application/zip", buffer });
  };
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-installed").click();
  await page.getByTestId("plugin-card-hello").click();
  await expect(page.getByTestId("plugin-panel")).toContainText("v1.0.0 is installed");

  // Newer: updated straight away
  await pick(zipOf(plugin("1.1.0")));
  await expect(page.getByTestId("plugin-panel")).toContainText("v1.1.0 is installed");
  await expect(page.getByTestId("plugin-card-hello")).toContainText("v1.1.0");

  // Another plugin's zip: refused
  const other = { ...plugin("9.0.0"), "manifest.json": JSON.stringify({ id: "other", name: "Other", version: "9.0.0", author: "X" }) };
  await pick(zipOf(other));
  await expect(page.getByTestId("toasts")).toContainText("That zip is “Other” (id \"other\"), not Hello");
  await expect(page.getByTestId("plugin-panel")).toContainText("v1.1.0 is installed");

  // Older: asks first
  await pick(zipOf(plugin("1.0.0")));
  await expect(page.getByTestId("confirm-dialog")).toContainText("v1.1.0 is installed now");
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Install v1.0.0" }).click();
  await expect(page.getByTestId("plugin-panel")).toContainText("v1.0.0 is installed");
});
