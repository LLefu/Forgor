// Small fixes to Milkdown's built files. Runs on `npm install` (postinstall);
// idempotent. Fails loudly when a target is gone, so a Milkdown update can't
// silently drop a fix.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PATCHES = [
  {
    // Let the slash menu match on `keywords` as well as the label, so "/h1" finds
    // "Heading 1" (keywords are set in src/features/editor/slashMenu.ts). Crepe has no option for this.
    name: "slash-menu keywords",
    files: ["crepe/lib/esm/index.js", "crepe/lib/esm/feature/block-edit/index.js", "crepe/lib/cjs/index.js", "crepe/lib/cjs/feature/block-edit/index.js"],
    from: "item.label.toLowerCase().includes(filter.toLowerCase())",
    to: '(item.label + " " + (item.keywords || "")).toLowerCase().includes(filter.toLowerCase())',
  },
  {
    // An image without a title has title null, but the image block's caption must be
    // a string: the note then failed to open ("Expected value of type string for attribute caption").
    name: "image caption null",
    files: ["components/lib/image-block/index.js", "components/lib/cjs/image-block/index.js"],
    from: "const caption = node.title;",
    to: 'const caption = node.title ?? "";',
  },
  {
    // Same for inline images: markdown without a title (or alt) gives null, the schema wants a string.
    name: "inline image title null",
    files: ["preset-commonmark/lib/index.js"],
    from: "const alt = node.alt;\n\t\t\t\tconst title = node.title;",
    to: 'const alt = node.alt ?? "";\n\t\t\t\tconst title = node.title ?? "";',
  },
];

let failed = false;
for (const p of PATCHES) {
  let done = 0;
  for (const rel of p.files) {
    const file = `node_modules/@milkdown/${rel}`;
    if (!existsSync(file)) continue;
    const src = readFileSync(file, "utf8");
    if (src.includes(p.to)) {
      done++;
      continue;
    }
    if (!src.includes(p.from)) continue;
    writeFileSync(file, src.split(p.from).join(p.to));
    done++;
  }
  if (done) console.log(`patch-milkdown: ${p.name} (${done} files)`);
  else {
    console.error(`patch-milkdown: "${p.name}" target not found; Milkdown changed, update scripts/patch-crepe.mjs`);
    failed = true;
  }
}
if (failed) process.exit(1);
