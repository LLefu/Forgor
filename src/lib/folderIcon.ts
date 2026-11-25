/** Folder icons: any image the user picks, scaled down to a small PNG stored with the folder (data URL). */

/** Square, in pixels (crisp at 2× for the 16–20px icons). */
export const ICON_SIZE = 128;
const MAX_INPUT = 20 * 1024 * 1024;

/** The image scaled to fit an ICON_SIZE square (transparent around it), as a PNG data URL. */
export async function imageToIcon(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image (PNG, JPG, SVG, WebP…)");
  if (file.size > MAX_INPUT) throw new Error("That image is too large (max 20 MB)");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("Couldn't read that image");
    });
    // SVGs without a size report 0.
    const w = img.naturalWidth || ICON_SIZE;
    const h = img.naturalHeight || ICON_SIZE;
    const scale = Math.min(ICON_SIZE / w, ICON_SIZE / h);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ICON_SIZE;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (ICON_SIZE - w * scale) / 2, (ICON_SIZE - h * scale) / 2, w * scale, h * scale);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * An icon handed over by a plugin (a Blob/File or an image data URL), scaled
 * like a picked one, so plugins can't store anything else in `folders.icon`.
 */
export async function iconFromPlugin(icon: Blob | string): Promise<string> {
  if (typeof icon !== "string") return imageToIcon(icon);
  const m = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/s.exec(icon);
  if (!m) throw new Error("setFolderIcon: give an image (Blob) or an image data URL");
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return imageToIcon(new Blob([bytes], { type: m[1] }));
}

/** Opens the file dialog; resolves with the chosen image as an icon, or null when cancelled. */
export function chooseIconImage(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      imageToIcon(file).then(resolve, reject);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
