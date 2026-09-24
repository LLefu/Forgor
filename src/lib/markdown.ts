const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Tidy the editor's markdown before it's written to disk:
 * Milkdown serializes empty paragraphs as `<br />` lines. Drop those
 * (outside code blocks) and collapse the blank lines they leave behind.
 */
export function cleanMarkdown(md: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "<br />") continue;
    if (!inFence && line.trim() === "" && out.length && out[out.length - 1].trim() === "") continue;
    out.push(line);
  }
  return out.join("\n");
}
