/** True inside the Tauri desktop shell (kept separate so Tauri APIs are only loaded when needed). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
