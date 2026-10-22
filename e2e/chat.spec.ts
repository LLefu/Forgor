import { test, expect } from "@playwright/test";
import { enablePlugin } from "./plugins";

// The browser build's chat models are fakes (src/platform/chat.ts): word-hash vectors, and an answer
// that cites the first source it was given ("Ik vond dit in "<title>" [1].").

async function openChat(page: import("@playwright/test").Page) {
  await page.goto("/");
  await enablePlugin(page, "chat");
  await page.getByTestId("plugin-models-download").click();
  await expect(page.getByTestId("plugin-models-download")).toHaveCount(0);
  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("chat-empty")).toBeVisible();
}

test("the chat needs its two models; without them it says so and offers the download", async ({ page }) => {
  await page.goto("/");
  await enablePlugin(page, "chat");
  await expect(page.getByTestId("plugin-panel").getByTestId("needs-language")).toBeVisible();
  await expect(page.getByTestId("plugin-panel").getByTestId("needs-search")).toBeVisible();
  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("chat-models")).toBeVisible();
  await page.getByTestId("chat-required-download").click();
  await expect(page.getByTestId("chat-empty")).toBeVisible();
});

test("an empty chat suggests English questions; clicking one asks it (tickets and PRs only with their plugins)", async ({ page }) => {
  await openChat(page);
  const empty = page.getByTestId("chat-empty");
  for (const q of ["What did we decide in the last meeting?", "What do I need to do this week?", "Which todo is the most important?"]) await expect(empty).toContainText(q);
  await expect(empty).not.toContainText("pull requests?");
  await expect(empty).toContainText("Type @ to attach a note, todo.");
  await empty.getByRole("button", { name: "Which todo is the most important?" }).click();
  await expect(page.getByTestId("chat-question")).toContainText("Which todo is the most important?");
  await expect(page.getByTestId("chat-answer").last()).toHaveAttribute("data-status", "done");
});

test("a question is answered from the notes, with a citation that opens the source", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openChat(page);
  await page.getByLabel("Your question").fill("When is the go-live of the Acme migration?");
  await page.keyboard.press("Enter");
  const answer = page.getByTestId("chat-answer").last();
  await expect(answer).toHaveAttribute("data-status", "done");
  await expect(answer.getByTestId("chat-answer-text")).toContainText("Kickoff 2026-09-22");
  await expect(answer.getByTestId("chat-sources")).toContainText("Kickoff 2026-09-22");

  // The [1] opens the note
  await answer.getByTestId("chat-cite").first().click();
  await expect(page.getByTestId("note-title")).toHaveValue("Kickoff 2026-09-22");

  // The conversation is still there when coming back, and "New chat" clears it
  await page.getByTestId("nav-chat").click();
  await expect(page.getByTestId("chat-question")).toHaveCount(1);
  await page.getByTestId("chat-new").click();
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  expect(errors).toEqual([]);
});

test("@ attaches a note or todo to the question; it's given to the model first", async ({ page }) => {
  await openChat(page);
  const input = page.getByLabel("Your question");
  await input.fill("Wat staat er in @proj");
  await expect(page.getByTestId("chat-picker")).toBeVisible();
  await expect(page.getByTestId("chat-picker").getByRole("option").first()).toContainText("Project plan");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("chat-attached")).toContainText("Project plan");
  await expect(input).toHaveValue("Wat staat er in ");

  // A todo too, from the @ button
  await page.getByRole("button", { name: "Attach" }).click();
  await page.keyboard.type("expense");
  await page.getByTestId("chat-picker").getByRole("option", { name: /Expense report/ }).click();
  await expect(page.getByTestId("chat-attached").getByTestId("chat-source")).toHaveCount(2);

  await input.fill("Wat staat er in dit plan?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("chat-question").getByTestId("chat-source")).toHaveCount(2);
  const answer = page.getByTestId("chat-answer").last();
  await expect(answer).toHaveAttribute("data-status", "done");
  await expect(answer.getByTestId("chat-answer-text")).toContainText("Project plan"); // the attached note is source 1
  await expect(page.getByTestId("chat-attached")).toHaveCount(0);
});

test("Mod+J opens the chat", async ({ page }) => {
  await openChat(page);
  await page.getByTestId("nav-today").click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("chat-page")).toBeVisible();
});
