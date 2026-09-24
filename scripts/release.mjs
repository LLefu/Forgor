// Usage: npm run release 0.2.0
// Bumps the version in package.json, tauri.conf.json and Cargo.toml, commits,
// tags v<version> and pushes. The Release workflow on GitHub does the rest.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { changelogSection } from "./changelog-section.mjs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run release <major.minor.patch>, e.g. npm run release 0.2.0");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain")) {
  console.error("Commit or stash your changes first; the working tree must be clean.");
  process.exit(1);
}
if (git("tag", "--list", `v${version}`)) {
  console.error(`Tag v${version} already exists.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const current = pkg.version;
const newer = version.split(".").map(Number);
const older = current.split(".").map(Number);
const isNewer = newer[0] - older[0] || newer[1] - older[1] || newer[2] - older[2];
if (isNewer <= 0) {
  console.error(`${version} must be higher than the current version ${current}; otherwise installed apps won't update.`);
  process.exit(1);
}

// Changelog: the "Unreleased" section becomes this version. Refuse to release without notes.
const changelogPath = "CHANGELOG.md";
const changelog = readFileSync(changelogPath, "utf8");
const unreleased = changelogSection(changelog, "Unreleased");
if (!/^\s*[-*]\s+\S/m.test(unreleased)) {
  console.error(`Add what changed under "## Unreleased" in CHANGELOG.md first (it appears in the app's version history and the release notes).`);
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
writeFileSync(changelogPath, changelog.replace(/^##\s+Unreleased\s*$/m, `## Unreleased\n\n## ${version} (${today})`));

pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

const cargoPath = "src-tauri/Cargo.toml";
writeFileSync(cargoPath, readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${version}"`));

// Keep the lockfiles in step so CI's `npm ci` doesn't complain.
const lockPath = "package-lock.json";
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = version;
if (lock.packages?.[""]) lock.packages[""].version = version;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
const cargoLockPath = "src-tauri/Cargo.lock";
writeFileSync(
  cargoLockPath,
  readFileSync(cargoLockPath, "utf8").replace(/(\[\[package\]\]\nname = "forgor"\nversion = )".*"/, `$1"${version}"`),
);

git("add", "package.json", lockPath, confPath, cargoPath, cargoLockPath, changelogPath);
git("commit", "-m", `Release v${version}`);
git("tag", `v${version}`);
console.log(`Committed and tagged v${version}. Pushing…`);
execFileSync("git", ["push", "origin", "HEAD", `v${version}`], { stdio: "inherit" });
console.log(`\nDone. Follow the build at https://github.com/LLefu/Forgor/actions`);
console.log(`Once it finishes, installed apps show "Update to ${version}" in the sidebar.`);
