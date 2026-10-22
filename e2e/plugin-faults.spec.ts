import { test, expect, type Page } from "@playwright/test";

// Plugins that misbehave on purpose. The app must stay up; one that causes a real problem is switched off at once and
// labelled (settings.pluginFaults), one that merely declares something wrongly only gets a warning. The browser build keeps
// plugins in memory and loads them with the same sourceURL as the desktop app, so errors are attributed the same way.

type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }> } };
const manifest = (extra: object = {}) => JSON.stringify({ id: "bad", name: "Bad bad", version: "0.1.0", author: "Someone", description: "Misbehaves.", ...extra });
const wrap = (extra: string, top = "") => `
  ${top}
  const React = require("react");
  module.exports = (api) => ({
    sidebar: () => React.createElement(api.ui.NavItem, { label: "Bad", icon: () => null, target: { kind: "plugin", plugin: api.id, page: "p" }, testId: "nav-bad" }),
    pages: { p: { useTab: () => ({ label: "Bad", icon: () => null }), component: () => React.createElement("div", { "data-testid": "bad-page" }, "page") } },
    ${extra}
  });`;

async function install(page: Page, js: string, extraManifest: object = {}) {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  const r = await page.evaluate(([m, main]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": main }), [manifest(extraManifest), js]);
  expect(r.error).toBeUndefined();
}

async function expectSwitchedOff(page: Page, message: string) {
  await expect(page.getByTestId("nav-plugins")).toBeVisible(); // the app is still there
  await page.getByTestId("nav-plugins").click();
  const card = page.getByTestId("plugin-card-bad");
  await expect(card.getByTestId("plugin-fault-label")).toHaveText("Error");
  await expect(card.getByTestId("plugin-fault")).toContainText(message);
  await expect(page.getByTestId("plugin-toggle-bad")).not.toBeChecked();
  await expect(page.getByTestId("nav-bad")).toHaveCount(0); // gone from the sidebar too
}

test("a tab label that throws: the plugin is switched off and labelled, the app stays", async ({ page }) => {
  await install(page, `module.exports = (api) => ({ sidebar: () => require("react").createElement(api.ui.NavItem, { label: "Bad", icon: () => null, target: { kind: "plugin", plugin: api.id, page: "p" }, testId: "nav-bad" }), pages: { p: { useTab: () => { throw new Error("tab boom"); }, component: () => null } } });`);
  await page.getByTestId("nav-bad").click();
  await expectSwitchedOff(page, "tab boom");
});

test("writing tools that throw: switched off right away, before any note is opened", async ({ page }) => {
  await install(page, wrap(`useWriter: () => { throw new Error("writer boom"); },`));
  await expectSwitchedOff(page, "writer boom");
});

test("an icon that throws gets the puzzle piece and the plugin is switched off", async ({ page }) => {
  await install(page, wrap(`icon: () => { throw new Error("icon boom"); },`));
  await page.getByTestId("nav-plugins").click();
  await expectSwitchedOff(page, "icon boom");
  await expect(page.getByTestId("plugin-card-bad").locator("svg.lucide-puzzle").first()).toBeVisible();
});

test("a settings panel that throws: switched off", async ({ page }) => {
  await install(page, wrap(`settings: () => { throw new Error("settings boom"); },`));
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-card-bad").click();
  await expectSwitchedOff(page, "settings boom");
});

test("a click handler that throws (nobody catches it): switched off, with the plugin named", async ({ page }) => {
  await install(page, wrap(`pages: { p: { useTab: () => ({ label: "Bad", icon: () => null }), component: () => React.createElement("button", { "data-testid": "boom", onClick: () => { throw new Error("click boom"); } }, "x") } },`));
  await page.getByTestId("nav-bad").click();
  await page.getByTestId("boom").click();
  await expectSwitchedOff(page, "click boom");
});

test("a timer that throws every 200 ms: switched off once, not 7 times", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page, wrap(`start: () => { const t = setInterval(() => { throw new Error("tick boom"); }, 200); return () => clearInterval(t); },`));
  await expectSwitchedOff(page, "tick boom");
  const before = errors.length;
  await page.waitForTimeout(1000);
  expect(errors.length).toBe(before); // the timer stopped with the plugin
  await expect(page.getByTestId("notice").filter({ hasText: "was switched off" })).toHaveCount(1);
});

test("a failed promise is a notice naming the plugin; five in a minute switch it off", async ({ page }) => {
  await install(page, wrap(`pages: { p: { useTab: () => ({ label: "Bad", icon: () => null }), component: () => React.createElement("button", { "data-testid": "reject", onClick: () => { Promise.reject(new Error("request failed")); } }, "x") } },`));
  await page.getByTestId("nav-bad").click();
  await page.getByTestId("reject").click();
  await expect(page.getByTestId("toasts")).toContainText("Plugin “Bad bad”");
  await expect(page.getByTestId("toasts")).toContainText("request failed");
  await expect(page.getByTestId("nav-bad")).toBeVisible(); // still on
  for (let i = 0; i < 4; i++) await page.getByTestId("reject").click({ timeout: 2000 }).catch(() => {});
  await expectSwitchedOff(page, "request failed");
});

test("wrong shapes are dropped with a warning; the plugin keeps working", async ({ page }) => {
  await install(page, wrap(`shortcuts: [{ id: "x", label: "X", keys: "Mod+Alt+9", run() {} }], today: "nope",`));
  await expect(page.getByTestId("nav-bad")).toBeVisible();
  await page.getByTestId("nav-plugins").click();
  const card = page.getByTestId("plugin-card-bad");
  await expect(card.getByTestId("plugin-warning")).toContainText("was ignored");
  await expect(page.getByTestId("plugin-toggle-bad")).toBeChecked();
  await expect(card.getByTestId("plugin-fault-label")).toHaveCount(0);
  await page.getByTestId("nav-bad").click();
  await expect(page.getByTestId("bad-page")).toBeVisible();
  // its shortcut is listed (without keys), and Mod+Alt+9 does not run it
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-tab-shortcuts").click();
  await expect(page.getByTestId("shortcut-bad:x")).toContainText("None");
});

test("made for a newer Forgor: it loads, with a warning, and says which version", async ({ page }) => {
  await install(page, wrap(``), { minAppVersion: "99.0.0" });
  await expect(page.getByTestId("nav-bad")).toBeVisible();
  await page.getByTestId("nav-plugins").click();
  const card = page.getByTestId("plugin-card-bad");
  await expect(card.getByTestId("plugin-warning")).toContainText("Made for Forgor 99.0.0");
  await expect(page.getByTestId("plugin-toggle-bad")).toBeChecked();
  await expect(card.getByTestId("plugin-error")).toHaveCount(0);

  // Made for the current or an older one: just says so
  await install(page, wrap(``), { minAppVersion: "1.0.0" });
  await page.getByTestId("nav-plugins").click();
  await expect(page.getByTestId("plugin-card-bad").getByTestId("plugin-made-for")).toHaveText("Made for Forgor 1.0.0");
});

test("a switched-off plugin isn't loaded again until it is switched on by hand; if it works then, the label goes", async ({ page }) => {
  // It crashes while window.__crash is set (so the test can "fix" it), and counts how often its code runs.
  await install(page, wrap(`useWriter: () => { if (window.__crash) throw new Error("writer boom"); return null; },`, `if (window.__crash === undefined) window.__crash = true; window.__badLoads = (window.__badLoads || 0) + 1;`));
  await expectSwitchedOff(page, "writer boom");
  const loads = () => page.evaluate(() => (window as unknown as { __badLoads: number }).__badLoads);
  const first = await loads();
  await page.getByTestId("reload-plugins").click();
  await page.waitForTimeout(400);
  expect(await loads()).toBe(first); // its code didn't run again
  await page.getByTestId("plugin-card-bad").click();
  await expect(page.getByTestId("plugin-panel")).toContainText("Not loaded");

  // "Fixed": switched on by hand it loads again, works, and the label is gone
  await page.evaluate(() => ((window as unknown as { __crash: boolean }).__crash = false));
  await page.getByTestId("plugin-toggle-bad").click();
  await expect.poll(loads).toBe(first + 1);
  await expect(page.getByTestId("plugin-toggle-bad")).toBeChecked();
  await expect(page.getByTestId("plugin-fault-label")).toHaveCount(0);
  await expect(page.getByTestId("plugin-fault")).toHaveCount(0);
  await expect(page.getByTestId("nav-bad")).toBeVisible();
});

test("switched on again while still broken: it fails again and is labelled again", async ({ page }) => {
  await install(page, wrap(`useWriter: () => { throw new Error("writer boom"); },`));
  await expectSwitchedOff(page, "writer boom");
  await page.getByTestId("plugin-toggle-bad").click();
  await expect(page.getByTestId("plugin-card-bad").getByTestId("plugin-fault-label")).toHaveText("Error");
  await expect(page.getByTestId("plugin-toggle-bad")).not.toBeChecked();
});

test("a dialog host that throws is caught by its own boundary: switched off", async ({ page }) => {
  await install(page, wrap(`hosts: [() => { throw new Error("host boom"); }],`));
  await expectSwitchedOff(page, "host boom");
});

type Ui = { __wn: { ui: { setState(s: object): void } } };

test("the app-wide boundary: a crash from a plugin's code in the app's own screen finds the plugin by its stack and switches it off", async ({ page }) => {
  // The tab bar builds a plugin tab's React key as `${tab.id}:…`; the id is an object whose toString (plugin code) throws for as
  // long as the plugin is on (React retries a failed render once by itself, so a one-off error would never reach the boundary).
  await install(page, wrap(``, `window.__bomb = { toString() { if (window.__wn.ui.getState().settings.plugins.bad) throw new Error("bomb boom"); return "tab-bomb"; } };`));
  await page.evaluate(() => {
    const w = window as unknown as Ui & { __bomb: unknown };
    w.__wn.ui.setState({ tabs: [{ id: w.__bomb, view: { kind: "plugin", plugin: "bad", page: "p" } }], activeTab: null });
  });
  await expectSwitchedOff(page, "bomb boom");
  await expect(page.getByTestId("app-crashed")).toHaveCount(0); // drawn again, no crash screen
});

test("the app-wide boundary: a crash with no plugin in it shows a screen with a way out, not a white page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  await page.evaluate(() => (window as unknown as Ui).__wn.ui.setState({ tabs: [{ id: "x", view: null }], activeTab: null }));
  await expect(page.getByTestId("app-crashed")).toContainText("Something went wrong");
  await expect(page.getByTestId("app-crashed-safe")).toBeVisible();
  await page.getByTestId("app-crashed-safe").click();
  await expect(page.getByTestId("nav-plugins")).toBeVisible(); // after the reload the app is back
  await expect(page.getByTestId("app-crashed")).toHaveCount(0);
});
