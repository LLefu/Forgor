import { beforeEach, describe, expect, it } from "vitest";
import { SqlJsDriver, MemoryVault } from "@/platform/memory";
import { setCtx } from "@/data/context";
import { migrate } from "@/data/schema";
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from "@/data/settings";
import { migrateView, useUI } from "@/app/store";
import { PLUGINS, setPluginEnabled } from "./registry";

let sql: SqlJsDriver;

beforeEach(async () => {
  sql = await SqlJsDriver.create();
  setCtx({ sql, vault: new MemoryVault() });
  await migrate(sql);
  useUI.setState({ settings: { ...DEFAULT_SETTINGS } });
});

describe("plugins after updating from 0.5.1", () => {
  it("turned-on features become enabled plugins, the others stay off", async () => {
    await saveSetting(sql, "meetingsEnabled", true);
    await saveSetting(sql, "jiraEnabled", true);
    expect((await loadSettings(sql)).plugins).toEqual({ meetings: true, writing: false, jira: true });
  });

  it("a fresh install starts with every plugin off", async () => {
    expect((await loadSettings(sql)).plugins).toEqual({ meetings: false, writing: false, jira: false });
  });

  it("once saved, the plugin choices are what counts", async () => {
    await saveSetting(sql, "jiraEnabled", true);
    await saveSetting(sql, "plugins", { jira: false, writing: true });
    expect((await loadSettings(sql)).plugins).toEqual({ jira: false, writing: true });
  });

  it("switching a plugin keeps the old flag in step (going back to 0.5.1 keeps the choice)", async () => {
    useUI.setState({ settings: await loadSettings(sql) });
    await setPluginEnabled("writing", true);
    let s = await loadSettings(sql);
    expect(s.plugins.writing).toBe(true);
    expect(s.writingEnabled).toBe(true);
    await setPluginEnabled("writing", false);
    s = await loadSettings(sql);
    expect(s.plugins.writing).toBe(false);
    expect(s.writingEnabled).toBe(false);
  });

  it("open tabs of the old Jira and Meetings pages become plugin pages", () => {
    expect(migrateView({ kind: "jira" })).toEqual({ kind: "plugin", plugin: "jira", page: "overview" });
    expect(migrateView({ kind: "jira-folder", folderId: "f1" })).toEqual({ kind: "plugin", plugin: "jira", page: "folder", param: "f1" });
    expect(migrateView({ kind: "meetings" })).toEqual({ kind: "plugin", plugin: "meetings", page: "list" });
    expect(migrateView({ kind: "note", id: "n1" })).toEqual({ kind: "note", id: "n1" });
    expect(migrateView({ kind: "today" })).toEqual({ kind: "today" });
    expect(migrateView({ kind: "calendar" })).toBeNull();
    expect(migrateView({ kind: "jira-folder" })).toBeNull();
  });

  it("every page an old tab can turn into exists", () => {
    for (const old of [{ kind: "jira" }, { kind: "jira-folder", folderId: "f" }, { kind: "meetings" }]) {
      const v = migrateView(old);
      if (v?.kind !== "plugin") throw new Error("not a plugin view");
      expect(PLUGINS.find((p) => p.id === v.plugin)?.pages?.[v.page]).toBeDefined();
    }
  });
});

describe("requirements", () => {
  it("enabling a plugin enables what it requires; disabling one disables what needs it", async () => {
    const base = { ...PLUGINS[0], id: "base", requires: undefined };
    const addon = { ...PLUGINS[0], id: "addon", requires: ["base"], disableBlocked: undefined };
    PLUGINS.push(base, addon);
    try {
      await setPluginEnabled("addon", true);
      expect(useUI.getState().settings.plugins).toMatchObject({ addon: true, base: true });
      await setPluginEnabled("base", false);
      expect(useUI.getState().settings.plugins).toMatchObject({ addon: false, base: false });
    } finally {
      PLUGINS.splice(PLUGINS.indexOf(base), 2);
    }
  });

  it("a plugin that is busy can't be disabled", async () => {
    await setPluginEnabled("meetings", true);
    const { useMeetingsStore } = await import("./meetings/state");
    useMeetingsStore.setState({ current: { id: "r1", startedAt: Date.now(), durationSec: null, systemAudio: true } });
    await expect(setPluginEnabled("meetings", false)).rejects.toThrow("Stop the recording first");
    expect(useUI.getState().settings.plugins.meetings).toBe(true);
    useMeetingsStore.setState({ current: null });
  });
});
