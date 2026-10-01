import { describe, expect, it } from "vitest";
import plist from "../../src-tauri/Info.plist?raw";
import conf from "../../src-tauri/tauri.conf.json";
import devConf from "../../src-tauri/tauri.dev.conf.json";

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
