import { expect, test, type Page } from "@playwright/test";

// Folder pages from a plugin: `folderView` sends a folder click to its page, `folderNotes` makes Acme/Acme.md the
// folder's own text (hidden, renamed with the folder, opening the page), `api.ui.NoteEditor` edits it on the page.

type Api = {
  data: { notes: { relocateFolder(id: string, path: string): Promise<unknown>; getFolderNote(id: string): Promise<{ id: string; path: string } | null>; listFolders(): Promise<{ id: string; path: string }[]> } };
  app: { openNote(id: string): void };
};
type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }>; vault: { readText(p: string): Promise<string>; exists(p: string): Promise<boolean> } } };

const main = `const React = require("react");
const h = React.createElement;
module.exports = (api) => {
  window.__folderApi = api;
  function FolderPage({ param }) {
    const [note, setNote] = React.useState(null);
    React.useEffect(() => { api.data.notes.ensureFolderNote(param).then(setNote); }, [param]);
    return h("div", { "data-testid": "folder-page" },
      h("button", { "data-testid": "open-panel", onClick: () => api.app.openFolder(param, { panel: true }) }, "Details"),
      note && h(api.ui.NoteEditor, { noteId: note.id }));
  }
  return {
    folderNotes: true,
    // Top-level folders only: subfolders keep the panel.
    folderView: (folder) => (folder.path.includes("/") ? null : "folder"),
    pages: { folder: { useTab: () => ({ label: "Folder", icon: () => null }), component: FolderPage } },
  };
};`;

const api = (page: Page) => page.evaluateHandle(() => (window as unknown as { __folderApi: Api }).__folderApi);
const exists = (page: Page, p: string) => page.evaluate((path) => (window as unknown as Wn).__wn.vault.exists(path), p);

async function install(page: Page) {
  const manifest = JSON.stringify({ id: "pages", name: "Folder pages", version: "0.1.0", author: "Test", description: "Folders as pages." });
  const r = await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest, main]);
  expect(r.error).toBeUndefined();
}

test("a folder opens as a plugin's page with its own text; the folder note hides, follows renames and opens the page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  await install(page);

  // A click on the folder: the page, with the folder's note made and editable on it
  await page.getByTestId("tree-folder-Acme migration").locator("span.truncate").click();
  await expect(page.getByTestId("folder-page")).toBeVisible();
  await expect(page.getByTestId("folder-panel")).toHaveCount(0);
  const editor = page.getByTestId("embedded-note").locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("About this client", { delay: 10 });
  await expect.poll(() => page.evaluate(() => (window as unknown as Wn).__wn.vault.readText("Acme migration/Acme migration.md"))).toContain("About this client");

  // Hidden from the explorer and from the panel's note list (the panel stays reachable from the page)
  await page.getByTestId("tree-folder-Acme migration").getByTestId("tree-toggle").click();
  await expect(page.getByTestId("tree-note-Project plan")).toBeVisible();
  await expect(page.getByTestId("tree-note-Acme migration")).toHaveCount(0);
  await page.getByTestId("open-panel").click();
  await expect(page.getByTestId("folder-panel")).toBeVisible();
  await expect(page.getByTestId("folder-panel").getByTestId("folder-note").filter({ hasText: "Acme migration" })).toHaveCount(0);

  // Renaming the folder renames its note
  const handle = await api(page);
  await page.evaluate(async (a) => {
    const f = (await a.data.notes.listFolders()).find((x) => x.path === "Acme migration")!;
    await a.data.notes.relocateFolder(f.id, "Acme");
  }, handle);
  await expect.poll(() => exists(page, "Acme/Acme.md")).toBe(true);
  expect(await exists(page, "Acme/Acme migration.md")).toBe(false);

  // Opening the folder note (search, links…) shows the folder's page
  await page.getByTestId("nav-today").click();
  await page.evaluate(async (a) => {
    const f = (await a.data.notes.listFolders()).find((x) => x.path === "Acme")!;
    a.app.openNote((await a.data.notes.getFolderNote(f.id))!.id);
  }, handle);
  await expect(page.getByTestId("folder-page")).toBeVisible();
  await expect(page.getByTestId("embedded-note")).toContainText("About this client");

  // Plugin off: an ordinary note in the folder again, and a click opens the panel
  await page.getByTestId("nav-plugins").click();
  await page.getByTestId("plugin-toggle-pages").click();
  await expect(page.getByTestId("tree-note-Acme")).toBeVisible();
  await page.getByTestId("tree-folder-Acme").locator("span.truncate").click();
  await expect(page.getByTestId("folder-panel")).toBeVisible();
  expect(errors).toEqual([]);
});
