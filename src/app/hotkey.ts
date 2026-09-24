import { isTauri } from "@/platform/tauri";

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

export async function showPopup() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const popup = await WebviewWindow.getByLabel("popup");
  if (!popup) return;
  await popup.center();
  await popup.show();
  await popup.setFocus();
  await popup.emit(EVT.popupShown);
}

export async function showMain() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;
  await main.unminimize();
  await main.show();
  await main.setFocus();
}

/** Register the global shortcut (replacing a previous one). Throws if the combo is invalid or taken. */
export async function applyHotkey(combo: string, previous?: string) {
  if (!isTauri()) return;
  const gs = await import("@tauri-apps/plugin-global-shortcut");
  if (previous && (await gs.isRegistered(previous))) await gs.unregister(previous);
  if (await gs.isRegistered(combo)) await gs.unregister(combo);
  await gs.register(combo, (e) => {
    if (e.state === "Pressed") void showPopup();
  });
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
