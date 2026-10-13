import { test, expect } from "@playwright/test";

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#e11d48"/></svg>`);

test("a folder gets an uploaded icon everywhere it's shown, and loses it again", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const row = page.getByTestId("tree-folder-Acme migration");
  await row.locator("span.truncate").click();
  const panel = page.getByTestId("folder-panel");

  // Upload from the folder panel
  await panel.getByTestId("folder-icon-button").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("folder-icon-upload").click();
  await (await chooser).setFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: svg });

  // Explorer, panel header, and folder labels (e.g. a todo's folder in Today) show it instead of the folder symbol
  await expect(row.getByTestId("folder-icon")).toBeVisible();
  await expect(row.locator("svg.lucide-folder")).toHaveCount(0);
  await expect(panel.getByTestId("folder-icon").first()).toBeVisible();
  const src = await row.getByTestId("folder-icon").getAttribute("src");
  expect(src).toMatch(/^data:image\/png;base64,/);
  const size = await row.getByTestId("folder-icon").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([128, 128]);
  await page.getByTestId("nav-today").click();
  await expect(page.getByTestId("todo-row").getByTestId("folder-icon").first()).toBeVisible();

  // Other folders keep the normal symbol
  await expect(page.getByTestId("tree-folder-Internal").getByTestId("folder-icon")).toHaveCount(0);

  // Remove via the explorer's right-click menu
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Icon" }).hover();
  await page.getByRole("menuitem", { name: "Remove icon" }).click();
  await expect(row.getByTestId("folder-icon")).toHaveCount(0);
  await expect(row.locator("svg.lucide-folder, svg.lucide-folder-open")).toHaveCount(1);
  expect(errors).toEqual([]);
});
