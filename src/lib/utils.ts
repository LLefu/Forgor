import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short random id (12 chars, base36). Short enough to embed in markdown markers. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}
