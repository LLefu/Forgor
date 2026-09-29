import type { Folder } from "@/data/types";
import { dirname } from "./paths";
import { isHex } from "./colors";

/**
 * Folder colors. Mid-tone shades that read well on light and dark backgrounds.
 * A folder without its own color inherits the nearest ancestor's color.
 * A color is either a preset id ("teal") or a custom "#rrggbb" (Settings.customColors).
 */
export const FOLDER_COLORS = [
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "orange", label: "Orange", hex: "#f97316" },
  { id: "amber", label: "Amber", hex: "#eab308" },
  { id: "green", label: "Green", hex: "#22c55e" },
  { id: "teal", label: "Teal", hex: "#14b8a6" },
  { id: "cyan", label: "Cyan", hex: "#06b6d4" },
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "indigo", label: "Indigo", hex: "#6366f1" },
  { id: "violet", label: "Violet", hex: "#a855f7" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "brown", label: "Brown", hex: "#a16207" },
] as const;

/** No longer offered (its slot became the "add color" button), but folders may still use it. */
const RETIRED: Record<string, string> = { gray: "#71717a" };

export function colorHex(id: string | null | undefined): string | null {
  if (isHex(id)) return id as string;
  return FOLDER_COLORS.find((c) => c.id === id)?.hex ?? (id ? (RETIRED[id] ?? null) : null);
}

/** Effective color of a folder: its own, else the nearest ancestor's, else null. */
export function effectiveFolderColor(folderId: string | null | undefined, folders: Folder[]): string | null {
  if (!folderId) return null;
  const byPath = new Map(folders.map((f) => [f.path, f]));
  let folder = folders.find((f) => f.id === folderId);
  while (folder) {
    const hex = colorHex(folder.color);
    if (hex) return hex;
    const parent = dirname(folder.path);
    folder = parent ? byPath.get(parent) : undefined;
  }
  return null;
}
