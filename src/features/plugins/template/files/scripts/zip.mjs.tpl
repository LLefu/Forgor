// Packs dist/ (after `vite build`) into <id>-<version>.zip: what Forgor installs
// (Plugins → Install from zip, or Update from zip in the plugin's panel).
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const files = {};
for (const name of ["manifest.json", "main.js", "styles.css"]) {
  const file = path.join("dist", name);
  if (fs.existsSync(file)) files[name] = new Uint8Array(fs.readFileSync(file));
}
// The icon file next to manifest.json: shown in the store and on the plugin's card.
for (const name of ["icon.svg", "icon.png"]) {
  if (fs.existsSync(name)) {
    files[name] = new Uint8Array(fs.readFileSync(name));
    break;
  }
}
if (!files["main.js"]) throw new Error("dist/main.js is missing: run `vite build` first (npm run zip does both).");
const out = `${manifest.id}-${manifest.version}.zip`;
fs.writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`${out} (${Math.round(fs.statSync(out).size / 1024)} KB): install it in Forgor with Plugins → Install from zip.`);
