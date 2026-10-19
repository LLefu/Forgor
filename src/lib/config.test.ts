import { describe, expect, it } from "vitest";
import plist from "../../src-tauri/Info.plist?raw";
import conf from "../../src-tauri/tauri.conf.json";
import devConf from "../../src-tauri/tauri.dev.conf.json";
import capabilities from "../../src-tauri/capabilities/default.json";
import access from "../../src-tauri/src/access.rs?raw";
import { MEETINGS_DIR, TRASH_DIR } from "./paths";

/** Settings that only matter on one OS, so they're easy to break without noticing. */
describe("tauri.conf.json", () => {
  it("lets the fs scope reach dot-folders like .trash on macOS", () => {
    // Defaults to true on Unix: "**" would then NOT match "<vault>/.trash/...",
    // and moving notes to the trash fails on macOS only.
    expect((conf.plugins as { fs?: { requireLiteralLeadingDot?: boolean } }).fs?.requireLiteralLeadingDot).toBe(false);
  });

  it("targets macOS 12+: llama.cpp needs std::filesystem (10.15+), and Tauri's default 10.13 broke the release build", () => {
    const v = (conf.bundle as { macOS?: { minimumSystemVersion?: string } }).macOS?.minimumSystemVersion ?? "10.13";
    expect(Number(v.split(".")[0])).toBeGreaterThanOrEqual(12);
  });

  it("disables native drag-drop on every window (it swallows HTML5 drags)", () => {
    for (const w of conf.app.windows) expect(w.dragDropEnabled).toBe(false);
  });
});

/** What the webview (and so every plugin) may reach: src-tauri/src/access.rs. */
describe("webview permissions", () => {
  const perms = capabilities.permissions as (string | { identifier: string; allow?: { path: string }[] })[];
  const ids = perms.map((p) => (typeof p === "string" ? p : p.identifier));

  it("limits files to the plugins folder (the notes folder is granted at runtime)", () => {
    const scope = perms.find((p) => typeof p !== "string" && p.identifier === "fs:scope") as { allow: { path: string }[] };
    for (const { path } of scope.allow) expect(path.startsWith("$APPDATA/plugins")).toBe(true);
    // fs:default reads all app data and, as a global scope, also lets every write command in there.
    expect(ids).not.toContain("fs:default");
    expect(conf.app.security.assetProtocol.scope).toEqual([]);
  });

  it("opens files only through access::open_path (which refuses programs)", () => {
    expect(ids).not.toContain("opener:allow-open-path");
  });

  it("can't open other database files: forgor.db is preloaded and sql:load isn't allowed", () => {
    expect(ids).not.toContain("sql:default");
    expect(ids).not.toContain("sql:allow-load");
    expect((conf.plugins as { sql?: { preload?: string[] } }).sql?.preload).toEqual(["sqlite:forgor.db"]);
  });

  it("has a content security policy without inline scripts", () => {
    const csp = conf.app.security.csp as Record<string, string> | null;
    expect(csp?.["script-src"]).toBeTruthy();
    expect(csp?.["script-src"]).not.toContain("unsafe-inline");
    expect(csp?.["object-src"]).toBe("'none'");
  });

  it("grants the app's own dot-folders by name (runtime grants skip dot-folders on macOS)", () => {
    for (const dir of [TRASH_DIR, MEETINGS_DIR]) expect(access).toContain(`"${dir}"`);
  });
});

describe("tauri.dev.conf.json", () => {
  it("gives `tauri dev` its own identifier, so it never shares the real database", () => {
    expect(devConf.identifier).not.toBe(conf.identifier);
  });
});

describe("Info.plist (macOS)", () => {
  it("explains mic and system audio use (macOS refuses access without it)", () => {
    expect(plist).toContain("<key>NSMicrophoneUsageDescription</key>");
    expect(plist).toContain("<key>NSAudioCaptureUsageDescription</key>");
  });
});
