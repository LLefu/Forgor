import { beforeEach, describe, expect, it } from "vitest";
import { SqlJsDriver, MemoryVault } from "@/platform/memory";
import { setCtx } from "@/data/context";
import { migrate } from "@/data/schema";
import { DEFAULT_SETTINGS, loadSettings } from "@/data/settings";
import { useUI } from "@/app/store";
import { decideStart, SAFE_MODE_AFTER } from "@/app/startup";
import { installPlugin, loadCommunityPlugins } from "./community";
import { reportPluginFault } from "./host";
import { getPlugin, setPluginEnabled } from "./registry";
import { needsNewerApp } from "./compat";

let sql: SqlJsDriver;

beforeEach(async () => {
  sql = await SqlJsDriver.create();
  setCtx({ sql, vault: new MemoryVault() });
  await migrate(sql);
  useUI.setState({ settings: { ...DEFAULT_SETTINGS } });
});

const files = (id: string, main = "module.exports = () => ({});", extra: object = {}) => ({
  "manifest.json": JSON.stringify({ id, name: `Plugin ${id}`, version: "1.0.0", author: "x", description: "y", ...extra }),
  "main.js": main,
});
const enable = (id: string, on = true) => useUI.setState((s) => ({ settings: { ...s.settings, plugins: { ...s.settings.plugins, [id]: on } } }));
const settings = () => useUI.getState().settings;

describe("a plugin that causes an error", () => {
  it("is switched off at once, labelled, and the label is saved", async () => {
    await installPlugin(files("flaky"));
    enable("flaky");
    reportPluginFault("flaky", new Error("it broke"), "its page");
    // in memory right away (a boundary that retries finds it off), saved a moment later
    expect(settings().plugins.flaky).toBe(false);
    expect(settings().pluginFaults.flaky).toMatchObject({ message: "it broke", where: "its page" });
    await new Promise((r) => setTimeout(r, 20));
    const saved = await loadSettings(sql);
    expect(saved.plugins.flaky).toBe(false);
    expect(saved.pluginFaults.flaky?.message).toBe("it broke");
  });

  it("a second error from the same plugin does nothing more", async () => {
    await installPlugin(files("flaky"));
    enable("flaky");
    reportPluginFault("flaky", new Error("first"), "a");
    reportPluginFault("flaky", new Error("second"), "b");
    expect(settings().pluginFaults.flaky.message).toBe("first");
  });

  it("a plugin that needs it is switched off with it", async () => {
    await installPlugin(files("base"));
    await installPlugin(files("needy", undefined, { requires: ["base"] }));
    enable("base");
    enable("needy");
    reportPluginFault("base", new Error("x"), "a");
    await new Promise((r) => setTimeout(r, 20));
    expect(settings().plugins).toMatchObject({ base: false, needy: false });
  });

  it("a built-in plugin's error is shown but it isn't switched off, and an unknown id is ignored", () => {
    enable("jira");
    reportPluginFault("jira", new Error("ours"), "a");
    expect(settings().plugins.jira).toBe(true);
    expect(settings().pluginFaults.jira).toBeUndefined();
    expect(() => reportPluginFault("nobody", new Error("x"), "a")).not.toThrow();
  });

  it("switched on by hand, the label goes and it may fail again", async () => {
    await installPlugin(files("flaky"));
    enable("flaky");
    reportPluginFault("flaky", new Error("first"), "a");
    await new Promise((r) => setTimeout(r, 20));
    expect(getPlugin("flaky")?.deferred).toBeFalsy(); // evaluated in this session: a plain switch-on is enough
    await setPluginEnabled("flaky", true);
    expect(settings().plugins.flaky).toBe(true);
    expect(settings().pluginFaults.flaky).toBeUndefined();
    reportPluginFault("flaky", new Error("again"), "b");
    expect(settings().plugins.flaky).toBe(false);
    expect(settings().pluginFaults.flaky.message).toBe("again");
  });
});

describe("switched-off plugins are not loaded", () => {
  it("after a restart a faulted plugin is only a name until it is switched on; then it loads", async () => {
    await installPlugin(files("flaky", "globalThis.__loads = (globalThis.__loads ?? 0) + 1; module.exports = () => ({});"));
    enable("flaky");
    const loads = () => (globalThis as unknown as { __loads: number }).__loads;
    const first = loads();
    reportPluginFault("flaky", new Error("x"), "a");
    await new Promise((r) => setTimeout(r, 20));
    await loadCommunityPlugins(); // like a restart
    expect(loads()).toBe(first); // its code didn't run
    expect(getPlugin("flaky")?.deferred).toBe(true);
    expect(getPlugin("flaky")?.name).toBe("Plugin flaky");
    await setPluginEnabled("flaky", true);
    expect(loads()).toBe(first + 1);
    expect(getPlugin("flaky")?.deferred).toBeFalsy();
    expect(settings().pluginFaults.flaky).toBeUndefined();
  });

  it("a plugin that is just switched off (no error) is loaded as before", async () => {
    await installPlugin(files("quiet"));
    enable("quiet", false);
    await loadCommunityPlugins();
    expect(getPlugin("quiet")?.deferred).toBeFalsy();
  });
});

describe("safe mode: Forgor didn't start properly the last times", () => {
  it("counts starts, and goes safe after two unhealthy ones in a row", () => {
    expect(decideStart(0)).toEqual({ count: 1, safeMode: false });
    expect(decideStart(SAFE_MODE_AFTER - 1).safeMode).toBe(false);
    expect(decideStart(SAFE_MODE_AFTER)).toEqual({ count: SAFE_MODE_AFTER + 1, safeMode: true });
  });

  it("switches every community plugin off and labels it, without running its code", async () => {
    await installPlugin(files("hangs", "globalThis.__hangs = (globalThis.__hangs ?? 0) + 1; module.exports = () => ({});"));
    await installPlugin(files("other"));
    enable("hangs");
    enable("other");
    enable("meetings");
    const runs = () => (globalThis as unknown as { __hangs: number }).__hangs;
    const before = runs();
    await loadCommunityPlugins({ safeMode: true });
    expect(runs()).toBe(before);
    expect(settings().plugins).toMatchObject({ hangs: false, other: false, meetings: true }); // built-in ones stay
    expect(settings().pluginFaults.hangs.message).toContain("didn't start properly");
    expect(getPlugin("hangs")?.deferred).toBe(true);
    // the next start (normal) doesn't load them either
    await loadCommunityPlugins();
    expect(runs()).toBe(before);
    // switched on by hand: loads
    await setPluginEnabled("hangs", true);
    expect(runs()).toBe(before + 1);
  });
});

describe("a plugin made for a newer Forgor", () => {
  it("loads, with a warning and the version it was made for", async () => {
    await installPlugin(files("future", undefined, { minAppVersion: "99.0.0" }));
    const p = getPlugin("future")!;
    expect(p.error).toBeUndefined();
    expect(p.minAppVersion).toBe("99.0.0");
    expect(p.warnings?.[0]).toContain("Made for Forgor 99.0.0");
    expect(needsNewerApp("99.0.0")).toBe(true);
    expect(needsNewerApp("0.0.1")).toBe(false);
    expect(needsNewerApp(undefined)).toBe(false);
  });
});
