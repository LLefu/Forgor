import { expect, type Page } from "@playwright/test";

/** Plugins page → switch the plugin on → its panel (details, models, settings) is open. */
export async function enablePlugin(page: Page, id: string) {
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId(`plugin-toggle-${id}`).click();
  await expect(page.getByTestId("plugins-enabled").getByTestId(`plugin-card-${id}`)).toBeVisible();
  await page.getByTestId(`plugin-card-${id}`).click();
  await expect(page.getByTestId("plugin-panel")).toBeVisible();
}

/** A model line in the open plugin panel. */
export const needs = (page: Page, model: string) => page.getByTestId("plugin-panel").getByTestId(`needs-${model}`);
