import { isTauri } from "./env";

/**
 * Desktop notifications (macOS Notification Center, Windows notifications) via
 * tauri-plugin-notification. The browser build (dev, e2e) keeps them in a
 * list instead (`sentNotifications`), so tests can see what would be shown.
 */

export interface DesktopNotification {
  title: string;
  body: string;
}

export interface Notifier {
  /** Shows it (silently), asking for permission the first time. False when not allowed. */
  send(n: DesktopNotification): Promise<boolean>;
  /** Plays a notification sound (Forgor's own, src-tauri/src/sound.rs). */
  playSound(name: string): Promise<void>;
  /** The system hides the banner while the app is in front (macOS): the app shows it itself then. */
  hiddenWhileInFront: boolean;
}

let notifier: Notifier | null = null;

export function notifications(): Notifier {
  notifier ??= isTauri() ? tauriNotifier() : memoryNotifier();
  return notifier;
}

function tauriNotifier(): Notifier {
  let allowed: Promise<boolean> | null = null;
  return {
    hiddenWhileInFront: /Mac/i.test(navigator.platform || navigator.userAgent),
    send: async (n) => {
      const api = await import("@tauri-apps/plugin-notification");
      // Ask once per run (macOS shows its own prompt the first time ever).
      allowed ??= (async () => (await api.isPermissionGranted()) || (await api.requestPermission()) === "granted")();
      if (!(await allowed)) {
        allowed = null; // they may allow it in System Settings later
        return false;
      }
      // No system sound: Forgor plays its own (the macOS one stayed silent), once per batch.
      api.sendNotification({ title: n.title, body: n.body });
      return true;
    },
    playSound: async (name) => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("play_sound", { name });
    },
  };
}

const sent: DesktopNotification[] = [];
const played: string[] = [];

/** Browser build only: what would have been shown and played. */
export const sentNotifications = () => sent;
export const playedSounds = () => played;

function memoryNotifier(): Notifier {
  return {
    hiddenWhileInFront: true,
    send: async (n) => {
      sent.push(n);
      return true;
    },
    playSound: async (name) => void played.push(name),
  };
}
