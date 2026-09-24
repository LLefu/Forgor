// Prints the CHANGELOG.md section for one version (used for GitHub release notes).
// Usage: node scripts/changelog-section.mjs 0.2.0
import { readFileSync } from "node:fs";

export function changelogSection(md, version) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${version.replace(/\./g, "\\.")}(\\s|$)`).test(l));
  if (start === -1) return "";
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

// Run directly (not when imported by the release script or workflow).
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/changelog-section.mjs")) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  process.stdout.write(changelogSection(readFileSync("CHANGELOG.md", "utf8"), version));
}
