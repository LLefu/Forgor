import { expect, test } from "@playwright/test";

// api.auth: a plugin signs in to a web service. The browser build's sign-in is a fake that succeeds at once
// (the real one, in Rust, has its own tests in src-tauri/src/oauth.rs); this checks what plugins see.

type Wn = { __wn: { installPlugin(files: Record<string, string>): Promise<{ error?: string }>; fakeOAuth: { signIns: number; refuse: boolean } } };

const main = `const React = require("react");
const h = React.createElement;
const mail = { clientId: "client-1", clientSecret: "not-secret", authUrl: "https://accounts.example.com/auth", tokenUrl: "https://oauth.example.com/token", scopes: ["mail.read"] };
module.exports = (api) => {
  function Page() {
    const [state, setState] = React.useState("…");
    const run = (fn) => fn().then((v) => setState(String(v)), (e) => setState("error: " + e.message));
    React.useEffect(() => { run(async () => ((await api.auth.getToken(mail, { interactive: false })) ? "signed in" : "signed out")); }, []);
    return h("div", null,
      h("p", { "data-testid": "auth-state" }, state),
      h("button", { "data-testid": "sign-in", onClick: () => run(async () => (await api.auth.getToken(mail)).accessToken) }, "Sign in"),
      h("button", { "data-testid": "call", onClick: () => run(async () => (await (await api.auth.fetch(mail, "https://api.example.com/me", { interactive: false })).json()).name) }, "Call"),
      h("button", { "data-testid": "sign-out", onClick: () => run(async () => { await api.auth.signOut(mail); return "signed out"; }) }, "Sign out"));
  }
  return {
    sidebar: () => h(api.ui.NavItem, { label: "Mail", icon: () => null, target: { kind: "plugin", plugin: api.id, page: "p" }, testId: "nav-mail" }),
    pages: { p: { useTab: () => ({ label: "Mail", icon: () => null }), component: Page } },
  };
};`;

test("a plugin signs in once, calls the service with the token, and signs out", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const seen: (string | null)[] = [];
  await page.route("https://api.example.com/me", async (route) => {
    seen.push(route.request().headers()["authorization"] ?? null);
    await route.fulfill({ json: { name: "Demo User" }, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.goto("/");
  await expect(page.getByTestId("nav-plugins")).toBeVisible();
  const manifest = JSON.stringify({ id: "mail", name: "Mail", version: "0.1.0", author: "Test", description: "Signs in." });
  const r = await page.evaluate(([m, js]) => (window as unknown as Wn).__wn.installPlugin({ "manifest.json": m, "main.js": js }), [manifest, main]);
  expect(r.error).toBeUndefined();
  await page.getByTestId("nav-mail").click();
  const state = page.getByTestId("auth-state");
  await expect(state).toHaveText("signed out");

  // Not signed in and not interactive: the call fails instead of opening a sign-in
  await page.getByTestId("call").click();
  await expect(state).toHaveText("error: Not signed in");

  // A cancelled sign-in is an error the plugin can show
  await page.evaluate(() => void ((window as unknown as Wn).__wn.fakeOAuth.refuse = true));
  await page.getByTestId("sign-in").click();
  await expect(state).toHaveText("error: Sign-in was cancelled");

  await page.getByTestId("sign-in").click();
  await expect(state).toHaveText("fake-token-mail");
  await page.getByTestId("call").click();
  await expect(state).toHaveText("Demo User");
  expect(seen).toEqual(["Bearer fake-token-mail"]);
  await page.getByTestId("sign-in").click(); // already signed in: no second sign-in
  expect(await page.evaluate(() => (window as unknown as Wn).__wn.fakeOAuth.signIns)).toBe(1);

  await page.getByTestId("sign-out").click();
  await expect(state).toHaveText("signed out");
  await page.getByTestId("call").click();
  await expect(state).toHaveText("error: Not signed in");
  expect(errors).toEqual([]);
});
