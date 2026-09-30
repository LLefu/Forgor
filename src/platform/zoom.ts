import { isTauri } from "./env";

/**
 * Scale the whole window like browser zoom (desktop only). The browser build
 * leaves zooming to the browser itself.
 */
export async function setWindowZoom(factor: number) {
  if (!isTauri()) return;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().setZoom(factor);
}
