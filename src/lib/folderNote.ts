import { basename, dirname, joinPath } from "./paths";

/**
 * Folder notes: `Acme/Acme.md` is the text of the folder "Acme" (Obsidian's
 * convention). Only special while a plugin claims folder notes (`folderNotes`):
 * then it's hidden from the explorer and the folder's note list, opens the
 * folder's page, and is renamed with its folder. Otherwise it's a normal note.
 */
export function folderNotePath(folderPath: string): string | null {
  return folderPath ? joinPath(folderPath, `${basename(folderPath)}.md`) : null;
}

export function isFolderNotePath(path: string): boolean {
  const dir = dirname(path);
  return !!dir && basename(path) === `${basename(dir)}.md`;
}
