/** File types by extension, for picking an icon or a player. */
export type FileKind = "image" | "video" | "audio" | "other";

const EXT: Record<Exclude<FileKind, "other">, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic"],
  video: ["mp4", "m4v", "webm", "mov", "ogv"],
  audio: ["mp3", "m4a", "wav", "ogg", "oga", "flac", "aac", "opus"],
};

export function fileKind(path: string): FileKind {
  const ext = path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  for (const [kind, list] of Object.entries(EXT)) if (list.includes(ext)) return kind as FileKind;
  return "other";
}

/** `accept` value for a file picker. */
export const ACCEPT = {
  image: EXT.image.map((e) => "." + e).join(","),
  video: EXT.video.map((e) => "." + e).join(","),
  audio: EXT.audio.map((e) => "." + e).join(","),
};
