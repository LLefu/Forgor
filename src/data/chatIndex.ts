import { ctx } from "./context";

/**
 * The AI chat's search index (schema v11): a vector per note section, todo or
 * plugin item, with a hash of the text it was made from. Vectors are stored as
 * base64 of their float32 bytes.
 */

export interface IndexRow {
  key: string;
  hash: string;
  vec: Float32Array;
}

function toBase64(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export async function loadIndex(): Promise<IndexRow[]> {
  const rows = await ctx().sql.select<{ key: string; hash: string; vec: string }>(`SELECT key, hash, vec FROM chat_index`);
  return rows.map((r) => ({ key: r.key, hash: r.hash, vec: fromBase64(r.vec) }));
}

export async function saveIndexRows(rows: IndexRow[]): Promise<void> {
  for (const r of rows) {
    await ctx().sql.execute(`INSERT INTO chat_index (key, hash, vec) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET hash = excluded.hash, vec = excluded.vec`, [
      r.key,
      r.hash,
      toBase64(r.vec),
    ]);
  }
}

export async function deleteIndexRows(keys: string[]): Promise<void> {
  for (const key of keys) await ctx().sql.execute(`DELETE FROM chat_index WHERE key = ?`, [key]);
}

/** Every note's text, for the index (content is the body without front matter). */
export async function listNoteTexts(): Promise<{ id: string; title: string; folderId: string | null; path: string; content: string; updatedAt: string }[]> {
  return ctx().sql.select(`SELECT id, title, folder_id AS folderId, path, content, updated_at AS updatedAt FROM notes`);
}
