import { isTauri } from "@/platform/env";

/**
 * Desktop-only glue between the main window, the global shortcut and the
 * quick popup window. All imports are dynamic so the browser build never
 * touches Tauri APIs.
 */

export const EVT = {
  openNote: "wn://open-note",
  openTodo: "wn://open-todo",
  dataChanged: "wn://data-changed",
  popupShown: "wn://popup-shown",
} as const;

export async function showMain() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;
  await main.unminimize();
  await main.show();
  await main.setFocus();
}

/**
 * Register the global shortcut (replacing any previous one). The shortcut
 * lives on the Rust side so it survives webview reloads. Throws if the combo
 * is invalid or taken by another app.
 */
export async function applyHotkey(combo: string) {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_hotkey", { combo });
}

/** Main window: react to requests coming from the popup. */
export async function listenForPopupRequests(handlers: {
  openNote: (id: string) => void;
  openTodo: (id: string) => void;
  dataChanged: () => void;
}) {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const offs = await Promise.all([
    listen<string>(EVT.openNote, (e) => handlers.openNote(e.payload)),
    listen<string>(EVT.openTodo, (e) => handlers.openTodo(e.payload)),
    listen(EVT.dataChanged, () => handlers.dataChanged()),
  ]);
  return () => offs.forEach((off) => off());
}

/** Popup window: tell the main window something happened, then hide. */
export async function notifyMain(event: string, payload?: string) {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", event, payload);
}

export async function hidePopup() {
  if (!isTauri()) return;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await getCurrentWebviewWindow().hide();
}
