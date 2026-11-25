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

test("a plugin sets a folder icon through the API: scaled like an uploaded one, anything else refused", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  const dataUrl = `data:image/svg+xml;base64,${svg.toString("base64")}`;
  const main = `module.exports = (api) => ({
    start: () => {
      (async () => {
        const folder = (await api.data.notes.listFolders()).find((f) => f.path === "Acme migration");
        const refused = await api.data.notes.setFolderIcon(folder.id, "not an image").then(() => "", (e) => e.message);
        await api.data.notes.setFolderIcon(folder.id, ${JSON.stringify(dataUrl)});
        window.__iconTest = { refused };
      })();
      return () => {};
    },
  });`;
  const manifest = JSON.stringify({ id: "icons", name: "Icons", version: "0.1.0", author: "Test", description: "Sets an icon." });
  const r = await page.evaluate(
    ([m, js]) => (window as unknown as { __wn: { installPlugin(f: Record<string, string>): Promise<{ error?: string }> } }).__wn.installPlugin({ "manifest.json": m, "main.js": js }),
    [manifest, main],
  );
  expect(r.error).toBeUndefined();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __iconTest?: { refused: string } }).__iconTest?.refused)).toMatch(/image/);
  const icon = page.getByTestId("tree-folder-Acme migration").getByTestId("folder-icon");
  await expect(icon).toBeVisible();
  expect(await icon.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  expect(await icon.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([128, 128]);
  expect(errors).toEqual([]);
});
