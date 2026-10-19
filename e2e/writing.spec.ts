import { test, expect, type Page } from "@playwright/test";
import { enablePlugin, needs } from "./plugins";

// The browser build's fake model answers "<selection> (herschreven: <instruction>)".

async function turnOn(page: Page) {
  await enablePlugin(page, "writing");
  await expect(needs(page, "language")).toContainText("not downloaded");
  await page.getByTestId("plugin-models-download").click();
  await expect(needs(page, "language").getByLabel("Downloaded")).toBeVisible();
}

/** The note's file as saved. */
const saved = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __wn: { vault: { readText(p: string): Promise<string> } } }).__wn.vault.readText(p), path);

async function newNote(page: Page, title: string, text: string) {
  await page.getByTestId("tree-folder-Internal").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New note" }).click();
  await page.keyboard.press("Escape");
  const t = page.getByTestId("note-title");
  await t.fill(title);
  await t.press("Enter");
  await page.keyboard.type(text);
}

test("writing tools are off until turned on and the model is there", async ({ page }) => {
  await page.goto("/");
  await newNote(page, "Plain", "Some text");
  await expect(page.getByTestId("note-ask-ai")).toHaveCount(0);
  await page.getByTestId("note-editor").locator("p").first().click({ clickCount: 3 });
  await expect(page.locator(".milkdown-toolbar")).toBeVisible();
  await expect(page.locator(".milkdown-toolbar").getByLabel("Ask AI")).toHaveCount(0);
});

test("rewrite the selection from the toolbar; the change is reviewed first", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await turnOn(page);
  await newNote(page, "Draft", "ik heb de klant gebelt");
  const editor = page.getByTestId("note-editor");

  await editor.locator("p").first().click({ clickCount: 3 });
  await page.locator(".milkdown-toolbar").getByLabel("Ask AI").click();
  const prompt = page.locator(".milkdown-ai-instruction input");
  await expect(prompt).toBeVisible();
  await prompt.fill("verbeter de spelling");
  await prompt.press("Enter");

  // Shown as a diff; the note isn't changed until accepted
  await expect(page.getByRole("button", { name: /Accept all/ })).toBeVisible();
  await expect(editor).toContainText("(herschreven: verbeter de spelling)");
  await page.waitForTimeout(1200); // longer than the save delay
  expect(await saved(page, "Internal/Draft.md")).not.toContain("herschreven");
  await page.getByRole("button", { name: /Accept all/ }).click();
  await expect(editor.locator("p").first()).toHaveText("ik heb de klant gebelt (herschreven: verbeter de spelling)");
  await expect.poll(() => saved(page, "Internal/Draft.md")).toContain("(herschreven: verbeter de spelling)");
  expect(errors).toEqual([]);
});

test("the AI button above the note works on the whole note, and rejecting keeps the text", async ({ page }) => {
  await page.goto("/");
  await turnOn(page);
  await newNote(page, "Whole", "Eerste zin.");
  const editor = page.getByTestId("note-editor");

  await page.getByTestId("note-ask-ai").click();
  await expect(page.getByText("Applies to the whole note")).toBeVisible();
  await page.getByTestId("ask-ai-input").fill("maak er een lijst van");
  await page.getByTestId("ask-ai-input").press("Enter");
  await expect(page.getByRole("button", { name: /Reject all/ })).toBeVisible();
  await expect(editor.locator(".milkdown-diff-controls").first()).toBeHidden(); // one decision for the whole change
  // Typing waits for the decision (the bar pulses); Esc rejects
  await editor.locator("p").first().click();
  await page.keyboard.type("x");
  await expect(editor.locator(".milkdown-ai-diff-actions.review-nudge")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor.locator("p").first()).toHaveText("Eerste zin.");
  await expect(editor).not.toContainText("herschreven");
});

test("an AI change keeps a restore point, warns when it loses an image, and can be undone", async ({ page }) => {
  await page.goto("/");
  await turnOn(page);
  await page.evaluate(async () => {
    const { vault } = (window as unknown as { __wn: { vault: { writeText(p: string, t: string): Promise<void>; emitChange(): void } } }).__wn;
    await vault.writeText("Internal/Pics.md", "Kijk hier.\n\n![boom](_attachments/boom.png)\n");
    vault.emitChange();
  });
  await page.getByTestId("tree-folder-Internal").getByTestId("tree-toggle").click();
  await page.getByTestId("tree-note-Pics").click();
  const editor = page.getByTestId("note-editor");
  await expect(editor).toContainText("Kijk hier.");
  const versions = () =>
    page.evaluate(async () => {
      const { sql } = (window as unknown as { __wn: { sql: { select<T>(q: string): Promise<T[]> } } }).__wn;
      return (await sql.select<{ content: string }>("SELECT content FROM note_versions")).map((v) => v.content);
    });
  expect(await versions()).not.toContainEqual(expect.stringContaining("Kijk hier."));

  await page.getByTestId("note-ask-ai").click();
  await page.getByTestId("ask-ai-input").fill("zonder afbeeldingen graag");
  await page.getByTestId("ask-ai-input").press("Enter");
  await expect(page.getByText("Check before accepting: the AI's version leaves out 1 image.")).toBeVisible();
  // The text from before the request is in the version history
  expect(await versions()).toContainEqual(expect.stringContaining("![boom](_attachments/boom.png)"));

  await page.getByRole("button", { name: /Accept all/ }).click();
  await expect.poll(() => saved(page, "Internal/Pics.md")).toContain("(herschreven");
  expect(await saved(page, "Internal/Pics.md")).not.toContain("boom.png");
  // Undo brings it back
  await editor.locator("p").first().click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(editor).not.toContainText("herschreven");
  await expect.poll(() => saved(page, "Internal/Pics.md")).toContain("](_attachments/boom.png)"); // (Crepe keeps the size in the alt text)
});

test("an empty answer puts the text back and says so", async ({ page }) => {
  await page.goto("/");
  await turnOn(page);
  await newNote(page, "Empty", "Blijft staan.");
  const editor = page.getByTestId("note-editor");
  await editor.locator("p").first().click({ clickCount: 3 });
  await page.locator(".milkdown-toolbar").getByLabel("Ask AI").click();
  await page.locator(".milkdown-ai-instruction input").fill("?");
  await page.locator(".milkdown-ai-instruction input").press("Enter");
  await expect(page.getByText("The AI didn't write anything")).toBeVisible();
  await expect(editor.locator("p").first()).toHaveText("Blijft staan.");
  await expect(page.getByRole("button", { name: /Accept all/ })).toHaveCount(0);
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typen werkt.");
  await expect(editor.locator("p").first()).toHaveText("Blijft staan. Typen werkt.");
});
