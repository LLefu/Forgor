/** Vault path helpers. Paths are relative, "/"-separated, no leading slash. */

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

export function stripMd(name: string): string {
  return name.replace(/\.md$/i, "");
}

/** Hidden from the explorer and indexer: dot-folders (.trash, .git, .obsidian) and attachment folders. */
export function isIgnoredPath(path: string): boolean {
  return path.split("/").some((seg) => seg.startsWith(".") || seg === ATTACHMENTS_DIR);
}

export const ATTACHMENTS_DIR = "_attachments";
export const TRASH_DIR = ".trash";

// Characters not allowed in Windows/macOS file names, including control characters.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** Make a title safe to use as a file/folder name on Windows and macOS. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(INVALID_CHARS, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return cleaned || "Untitled";
}

/** Returns `base`, or `base 2`, `base 3`… so that `exists(candidate + ext)` is false. */
export async function uniqueName(
  dir: string,
  base: string,
  ext: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  let candidate = base;
  for (let n = 2; await exists(joinPath(dir, candidate + ext)); n++) candidate = `${base} ${n}`;
  return joinPath(dir, candidate + ext);
}

/** Relative path from a note's folder to a target path (both vault-relative). */
export function relativePath(fromDir: string, target: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const to = target.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

/** Resolve a relative reference (e.g. from a markdown link) against a folder. */
export function resolvePath(fromDir: string, rel: string): string {
  const out = fromDir ? fromDir.split("/") : [];
  for (const seg of decodeURI(rel).split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}
