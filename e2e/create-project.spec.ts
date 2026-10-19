import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

test("create a plugin project: the browser build downloads it, with the example, the build, the zip command and AGENTS.md", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-installed").click();
  await page.getByTestId("create-plugin-project").click();
  const dialog = page.getByTestId("create-project-dialog");
  await dialog.getByLabel("Plugin name").fill("Daily Quote!");
  await expect(dialog.getByLabel("Plugin id")).toHaveValue("daily-quote");
  await dialog.getByLabel("Author").fill("Sam");
  await dialog.getByLabel("Description").fill("A quote every day.");
  const download = page.waitForEvent("download");
  await dialog.getByTestId("create-project-confirm").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("daily-quote.zip");
  await expect(dialog.getByTestId("create-project-done")).toContainText("npm run zip");

  const entries = unzipSync(new Uint8Array(fs.readFileSync(await file.path())));
  const files = Object.keys(entries).map((n) => n.replace(/^daily-quote\//, ""));
  for (const f of ["AGENTS.md", "CLAUDE.md", "README.md", ".gitignore", "manifest.json", "package.json", "tsconfig.json", "vite.config.ts", "scripts/zip.mjs", "src/index.tsx", "src/icon.tsx", "src/styles.css", "icon.svg", "types/forgor-plugin-api.d.ts", "forgor/theme.css"]) {
    expect(files).toContain(f);
  }
  const read = (f: string) => strFromU8(entries[`daily-quote/${f}`]);
  expect(JSON.parse(read("manifest.json"))).toMatchObject({ id: "daily-quote", name: "Daily Quote!", author: "Sam", version: "1.0.0" });
  expect(JSON.parse(read("package.json")).scripts.zip).toBe("vite build && node scripts/zip.mjs");
  expect(read("src/index.tsx")).toContain('const NAME = "Daily Quote!";');
  expect(read("AGENTS.md")).toContain("# Daily Quote!: a Forgor plugin");
  expect(read("CLAUDE.md").trim()).toBe("@AGENTS.md");
  expect(read("AGENTS.md")).toContain("## Icon");
  expect(read("AGENTS.md")).toContain("## Style guide");
  expect(read("icon.svg")).toContain('viewBox="0 0 24 24"');
});

test("a project made from the template builds into a plugin that works", async ({ page }) => {
  // Built by `node scripts/plugin-template.mjs` (part of `npm run e2e`).
  const zip = path.resolve(".plugin-template-check/template-check-1.0.0.zip");
  await page.goto("/");
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugins-tab-installed").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("install-plugin-zip").click();
  await (await chooser).setFiles(zip);
  await page.getByTestId("confirm-dialog").getByRole("button", { name: "Install" }).click();
  const card = page.getByTestId("plugins-enabled").getByTestId("plugin-card-template-check");
  await expect(card).toContainText("Forgor · v1.0.0 · Community");
  // Its icon.svg, drawn as a shape in the theme color
  await expect(card.locator('[style*="mask"]')).toBeVisible();

  // Its page lists recent notes; its setting changes the greeting
  await page.getByRole("button", { name: "Template check" }).first().click();
  await expect(page.getByTestId("main")).toContainText("Hello! You have");
  await expect(page.getByTestId("main")).toContainText("Recently edited");
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-card-template-check").click();
  await page.getByTestId("plugin-settings").getByLabel("Greeting").fill("Hoi");
  await page.getByRole("button", { name: "Template check" }).first().click();
  await expect(page.getByTestId("main")).toContainText("Hoi! You have");
});
