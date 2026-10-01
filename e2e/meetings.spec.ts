import { test, expect } from "@playwright/test";

test("meeting recordings: set up, record, name + folder, transcript in the note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-meetings")).toHaveCount(0); // off by default

  // Settings: turn it on, download the models (fake in the browser build)
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("meetings-toggle").click();
  await expect(page.getByTestId("model-speech")).toContainText("not downloaded");
  await page.getByTestId("download-models").click();
  await expect(page.getByTestId("model-speech").getByLabel("Downloaded")).toBeVisible();
  await expect(page.getByTestId("model-summary").getByLabel("Downloaded")).toBeVisible();
  await expect(page.getByTestId("download-models")).toHaveCount(0);
  await expect(page.getByLabel("Microphone")).toBeVisible();

  // Record from the Meetings page
  await page.getByTestId("nav-meetings").click();
  await page.getByTestId("start-recording").click();
  await expect(page.getByTestId("recording-indicator")).toBeVisible();
  await page.getByTestId("stop-recording").click();

  // Name it and put it in a folder
  const dialog = page.getByTestId("name-recording");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("recording-name")).toHaveValue(/^Meeting \d+ \w+ \d\d\.\d\d$/);
  await page.getByTestId("recording-name").fill("Kick-off Acme");
  await page.getByTestId("recording-folder").click();
  await page.getByRole("button", { name: "Acme migration" }).first().click();
  await page.getByTestId("save-recording").click();
  await expect(dialog).toHaveCount(0);

  // Processed: listed as done, and the note has summary + transcript
  const row = page.locator('[data-testid="meeting-row"][data-title="Kick-off Acme"]');
  await expect(row).toBeVisible();
  await expect(row.getByTestId("meeting-processing")).toHaveCount(0);
  await expect(row.getByTestId("meeting-folder")).toContainText("Acme migration");
  await row.getByRole("button", { name: "Kick-off Acme" }).click();
  await expect(page.getByTestId("note-title")).toHaveValue("Kick-off Acme");
  await expect(page.locator(".milkdown")).toContainText("Samenvatting");
  await expect(page.locator(".milkdown")).toContainText("Goedemorgen allemaal");
  // It shows in its folder in the explorer (opening the note expanded the folder)
  await expect(page.getByTestId("tree-note-Kick-off Acme")).toBeVisible();

  // Unassigning hides it from the explorer again (it stays under Meetings)
  await page.getByTestId("nav-meetings").click();
  await row.getByTestId("meeting-folder").click();
  await page.getByRole("button", { name: "Unassigned" }).click();
  await expect(row.getByTestId("meeting-folder")).toContainText("Unassigned");
  await expect(page.getByTestId("tree-note-Kick-off Acme")).toHaveCount(0);
});

test("closing the name dialog keeps the recording unassigned under its default name", async ({ page }) => {
  await page.goto("/?empty");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("meetings-toggle").click();
  await page.getByTestId("download-models").click();
  await expect(page.getByTestId("model-speech").getByLabel("Downloaded")).toBeVisible();
  await page.getByTestId("nav-meetings").click();
  await expect(page.getByTestId("speakers-missing")).toHaveCount(0); // all models were downloaded
  await page.getByTestId("start-recording").click();
  await page.getByTestId("stop-recording").click();
  await expect(page.getByTestId("name-recording")).toBeVisible();
  await page.keyboard.press("Escape");
  const row = page.getByTestId("meeting-row");
  await expect(row).toHaveAttribute("data-title", /^Meeting /);
  await expect(row.getByTestId("meeting-folder")).toContainText("Unassigned");
  await expect(page.getByTestId("explorer").locator('[data-testid^="tree-note-"]')).toHaveCount(0);
});

test("naming the speakers rebuilds the transcript and the summary", async ({ page }) => {
  await page.goto("/?empty");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("meetings-toggle").click();
  await page.getByTestId("download-models").click();
  await expect(page.getByTestId("model-speakers").getByLabel("Downloaded")).toBeVisible();
  await expect(page.getByTestId("model-summary").getByLabel("Downloaded")).toBeVisible();
  await page.getByTestId("nav-meetings").click();
  await page.getByTestId("start-recording").click();
  await page.getByTestId("stop-recording").click();
  await page.getByTestId("save-recording").click();

  const row = page.getByTestId("meeting-row");
  await expect(row.getByTestId("meeting-processing")).toHaveCount(0);
  await row.getByRole("button").first().click(); // open the note
  await expect(page.locator(".milkdown")).toContainText("Spreker 2:");

  await page.getByTestId("note-speakers").click();
  const dialog = page.getByTestId("speakers-dialog");
  await expect(dialog.getByTestId("speaker-row")).toHaveCount(2);
  await expect(dialog).toContainText("Top. Dan bel ik de klant over de oplevering."); // a quote to recognize the voice
  await dialog.getByLabel("Name for Spreker 2").fill("Jeroen");
  await dialog.getByTestId("save-speakers").click();
  await expect(dialog).toHaveCount(0);

  const editor = page.locator(".milkdown");
  await expect(editor).toContainText("Jeroen: Top. Dan bel ik de klant over de oplevering.");
  await expect(editor).toContainText("Jeroen: klant bellen over de oplevering"); // summary made again with the name
  await expect(editor).toContainText("Spreker 1:");
  await expect(editor).not.toContainText("Spreker 2");
});

test("the Meetings page offers speaker separation when it isn't downloaded", async ({ page }) => {
  await page.goto("/?empty");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("meetings-toggle").click();
  await page.getByTestId("model-speech").getByRole("button", { name: "Download" }).click();
  await expect(page.getByTestId("model-speech").getByLabel("Downloaded")).toBeVisible();
  await page.getByTestId("nav-meetings").click();
  const notice = page.getByTestId("speakers-missing");
  await expect(notice).toContainText("Anderen");
  await notice.getByRole("button", { name: /Download/ }).click();
  await expect(notice).toHaveCount(0);
});

test("a named voice is recognized in the next meeting, and can be forgotten", async ({ page }) => {
  await page.goto("/?empty");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("meetings-toggle").click();
  await page.getByTestId("download-models").click();
  await expect(page.getByTestId("model-summary").getByLabel("Downloaded")).toBeVisible();
  const record = async () => {
    await page.getByTestId("nav-meetings").click();
    await page.getByTestId("start-recording").click();
    await page.getByTestId("stop-recording").click();
    await page.getByTestId("save-recording").click();
    await expect(page.getByTestId("meeting-processing")).toHaveCount(0);
  };

  // Meeting 1: name the second voice
  await record();
  await page.getByTestId("name-speakers").first().click();
  await page.getByLabel("Name for Spreker 2").fill("Jeroen");
  await page.getByTestId("save-speakers").click();
  await expect(page.getByTestId("speakers-dialog")).toHaveCount(0);

  // Meeting 2: Jeroen is filled in by himself, in the transcript and the summary
  await page.waitForTimeout(1100); // a new recording id (they are timestamps)
  await record();
  const newest = page.getByTestId("meeting-row").first();
  await newest.getByRole("button").first().click();
  await expect(page.locator(".milkdown")).toContainText("Jeroen: Top. Dan bel ik de klant over de oplevering.");
  await expect(page.locator(".milkdown")).toContainText("Jeroen: klant bellen over de opleveringTranscript");
  await page.getByTestId("note-speakers").click();
  await expect(page.getByLabel("Name for Spreker 2")).toHaveValue("Jeroen");
  await expect(page.getByTestId("speakers-dialog")).toContainText("Recognized");
  await page.keyboard.press("Escape");

  // Settings lists the voice; forgetting it works
  await page.getByTestId("nav-settings").click();
  const known = page.getByTestId("known-voices");
  await expect(known).toContainText("Jeroen");
  await known.getByLabel("Forget Jeroen's voice").click();
  await page.getByRole("button", { name: "Forget" }).last().click();
  await expect(page.getByTestId("known-voices")).toHaveCount(0);
});

test("while recording: level meters, and warnings for a silent mic, no computer sound and 10 minutes of silence", async ({ page }) => {
  await page.goto("/?empty");
  await page.getByTestId("nav-settings").click();
  await page.getByTestId("meetings-toggle").click();
  await page.getByTestId("model-speech").getByRole("button", { name: "Download" }).click();
  await expect(page.getByTestId("model-speech").getByLabel("Downloaded")).toBeVisible();
  await page.getByTestId("nav-meetings").click();
  await expect(page.getByTestId("recording-status")).toHaveCount(0);
  await page.getByTestId("start-recording").click();

  const status = page.getByTestId("recording-status");
  await expect(status.getByTestId("meter-mic")).toBeVisible();
  await expect(status.getByTestId("meter-system")).toBeVisible();
  await expect(status.getByTestId("recording-warning")).toHaveCount(0);

  type Sim = { __wn: { meetings: { simulate(l: object): void } } };
  await page.evaluate(() => (window as unknown as Sim).__wn.meetings.simulate({ micSignal: false, elapsedSec: 10 }));
  await expect(status.getByTestId("recording-warning")).toContainText("No sound from your microphone");
  await page.evaluate(() => (window as unknown as Sim).__wn.meetings.simulate({ micSignal: true, systemAudio: false, silentSec: 700 }));
  await expect(status.getByTestId("meter-system")).toHaveCount(0);
  await expect(status).toContainText("Only your microphone is being recorded");
  await expect(status).toContainText("Nothing heard for 11 minutes");
  await page.evaluate(() => (window as unknown as Sim).__wn.meetings.simulate({ systemAudio: true, silentSec: 0 }));
  await expect(status.getByTestId("recording-warning")).toHaveCount(0);

  await page.getByTestId("stop-recording").click();
  await expect(page.getByTestId("recording-status")).toHaveCount(0);
});
