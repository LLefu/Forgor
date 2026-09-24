import { describe, expect, it } from "vitest";
import changelogMd from "../../CHANGELOG.md?raw";
import pkg from "../../package.json";
import { parseChangelog, sectionMarkdown } from "./changelog";
// @ts-expect-error plain JS module shared with the release script and workflow
import { changelogSection } from "../../scripts/changelog-section.mjs";

describe("changelog", () => {
  const sample = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "## 0.2.0 (2026-10-01)",
    "### New",
    "- Version history",
    "- **Bold** thing",
    "### Fixed",
    "- Trash on macOS",
    "",
    "## 0.1.0 (2026-09-24)",
    "- First release",
  ].join("\n");

  it("parses versions, dates and groups; drops an empty Unreleased", () => {
    const v = parseChangelog(sample);
    expect(v.map((x) => [x.version, x.date])).toEqual([
      ["0.2.0", "2026-10-01"],
      ["0.1.0", "2026-09-24"],
    ]);
    expect(v[0].groups).toEqual([
      { title: "New", items: ["Version history", "**Bold** thing"] },
      { title: "Fixed", items: ["Trash on macOS"] },
    ]);
    expect(v[1].groups).toEqual([{ title: null, items: ["First release"] }]);
    expect(sectionMarkdown(v[0])).toBe("### New\n- Version history\n- **Bold** thing\n\n### Fixed\n- Trash on macOS");
  });

  it("extracts one section for release notes", () => {
    expect(changelogSection(sample, "0.2.0")).toBe("### New\n- Version history\n- **Bold** thing\n### Fixed\n- Trash on macOS");
    expect(changelogSection(sample, "9.9.9")).toBe("");
  });

  it("the real CHANGELOG.md parses and documents every released version", () => {
    const versions = parseChangelog(changelogMd).map((v) => v.version);
    expect(versions).toContain(pkg.version);
  });
});
