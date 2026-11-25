import { test, expect, type Page } from "@playwright/test";

// Color themes from a plugin (`themes`): picked in Settings → Appearance → Colors, set as CSS variables on <html>.

type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }> } };

const main = `module.exports = () => ({
  themes: [
    { id: "duo", name: "Duo", light: { background: "#fdf6ec", primary: "#b45309" }, dark: { "--background": "#1c1208", "--primary": "#f59e0b" } },
    { id: "night", name: "Night", dark: { background: "#0b0b1a" } },
  ],
});`;

async function install(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  const manifest = JSON.stringify({ id: "themes", name: "Theme pack", version: "0.1.0", author: "Test", description: "Two themes." });
  const r = await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest, main]);
  expect(r.error).toBeUndefined();
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-tab-appearance").click();
}

const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const html = (page: Page) => page.locator("html");

test("a plugin's theme sets the colors, replaces the highlight color and follows light/dark", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await install(page);
  const theme = page.getByLabel("Theme", { exact: true });
  await theme.selectOption("light-soft");
  await expect(html(page)).toHaveClass(/soft/);

  await page.getByTestId("theme-preset").selectOption({ label: "Duo (Theme pack)" });
  await expect(html(page)).toHaveAttribute("data-theme-preset", "themes:duo");
  expect(await cssVar(page, "--background")).toBe("#fdf6ec");
  expect(await cssVar(page, "--primary")).toBe("#b45309");
  await expect(html(page)).not.toHaveClass(/soft/); // a theme has its own colors: no soft variant
  await expect(page.getByTestId("accent-picker")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Duo has its own highlight color.")).toBeVisible();

  await theme.selectOption("dark");
  await expect(html(page)).toHaveClass(/dark/);
  expect(await cssVar(page, "--background")).toBe("#1c1208");
  expect(await cssVar(page, "--primary")).toBe("#f59e0b");

  // Dark only, no primary: always dark, the highlight color is the user's again
  await theme.selectOption("light");
  await page.getByTestId("theme-preset").selectOption({ label: "Night (Theme pack)" });
  await expect(html(page)).toHaveClass(/dark/);
  await expect(theme).toBeDisabled();
  await expect(page.getByText("Night only comes in dark.")).toBeVisible();
  expect(await cssVar(page, "--background")).toBe("#0b0b1a");
  expect(await cssVar(page, "--primary")).toBe("#6366f1"); // indigo, dark shade
  await expect(page.getByTestId("accent-picker")).not.toHaveAttribute("aria-disabled");

  // Switching the plugin off brings Forgor's own colors back
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-toggle-themes").click();
  await expect(html(page)).not.toHaveAttribute("data-theme-preset");
  await expect(html(page)).not.toHaveClass(/dark/);
  expect(await cssVar(page, "--background")).toBe("#ffffff");
  expect(errors).toEqual([]);
});

test("Forgor's own colors: no Colors row without a theme plugin", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-tab-appearance").click();
  await expect(page.getByLabel("Theme", { exact: true })).toBeVisible();
  await expect(page.getByTestId("theme-preset")).toHaveCount(0);
});
