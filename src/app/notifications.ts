import { create } from "zustand";
import { useUI } from "./store";
import { ctx } from "@/data/context";
import { getPluginValue, setPluginValue } from "@/data/pluginStorage";
import { notifications, type DesktopNotification } from "@/platform/notifications";
import { showNotice } from "@/components/Toasts";

/**
 * Desktop notifications for anything in the app (plugins first: Jira,
 * Bitbucket, community plugins through `api.notifications`). A source checks
 * for news on a timer (`pollForNotifications`) and hands what it found to
 * `notifyNew`, which remembers what was already shown, so only new things
 * notify: the first check only takes stock. Everything runs in the main
 * window, also while it's hidden in the tray, but not when Forgor is quit.
 *
 * Kinds are "<source>:<kind>" (e.g. "bitbucket:review"); each can be switched
 * off (a plugin's panel lists its kinds), and all of them in Settings.
 */

export interface NotifyItem {
  /** Stable and unique within the kind (a PR, a ticket key, a comment id). */
  id: string;
  title: string;
  body: string;
  /** What clicking it in the history opens (in the source plugin). */
  open?: NotificationTarget;
}

/** A page and/or right-hand panel of the source plugin. */
export interface NotificationTarget {
  page?: string;
  pageParam?: string;
  panel?: string;
  panelParam?: string;
}

/** A notification in the history (the bell in the sidebar). */
export interface HistoryEntry {
  /** Unique in the history. */
  id: string;
  source: string;
  kind: string;
  title: string;
  body: string;
  /** ISO time it came in. */
  at: string;
  open?: NotificationTarget;
  read: boolean;
}

/** Kept in the history (newest). */
const MAX_HISTORY = 100;
const HISTORY_KEY = "notification_history";

export const useNotificationHistory = create<{ entries: HistoryEntry[]; loaded: boolean }>(() => ({ entries: [], loaded: false }));

let loading: Promise<void> | null = null;

/** Reads the history from the database once (the settings table; loadSettings skips unknown keys). */
export function loadNotificationHistory(): Promise<void> {
  loading ??= (async () => {
    const rows = await ctx().sql.select<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [HISTORY_KEY]);
    let entries: HistoryEntry[] = [];
    try {
      entries = rows.length ? (JSON.parse(rows[0].value) as HistoryEntry[]) : [];
    } catch {
      // a broken history starts empty
    }
    useNotificationHistory.setState({ entries: Array.isArray(entries) ? entries : [], loaded: true });
  })();
  return loading;
}

async function saveHistory(entries: HistoryEntry[]) {
  useNotificationHistory.setState({ entries });
  await ctx().sql.execute(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [HISTORY_KEY, JSON.stringify(entries)]);
}

async function record(source: string, kind: string, items: (DesktopNotification & { id?: string; open?: NotificationTarget })[]) {
  await loadNotificationHistory();
  const at = new Date().toISOString();
  const added = items.map((i, n) => ({ id: `${source}:${kind}:${i.id ?? n}:${at}`, source, kind, title: i.title, body: i.body, at, open: i.open, read: false }));
  await saveHistory([...added.reverse(), ...useNotificationHistory.getState().entries].slice(0, MAX_HISTORY));
}

export const markNotificationRead = (id: string) => saveHistory(useNotificationHistory.getState().entries.map((e) => (e.id === id && !e.read ? { ...e, read: true } : e)));
export const deleteNotification = (id: string) => saveHistory(useNotificationHistory.getState().entries.filter((e) => e.id !== id));
export const clearNotifications = () => saveHistory([]);

/** Clicking one in the history: its source's page and/or panel. */
export function openNotification(entry: HistoryEntry) {
  const ui = useUI.getState();
  const t = entry.open;
  if (!t) return;
  if (t.page) ui.setView({ kind: "plugin", plugin: entry.source, page: t.page, ...(t.pageParam ? { param: t.pageParam } : {}) });
  if (t.panel && t.panelParam) ui.openPluginPanel({ plugin: entry.source, panel: t.panel, param: t.panelParam, fromFolder: null });
}

/** Up to this many at once are shown one by one; more become one summary. */
const MAX_SINGLE = 3;
/** Remembered ids per kind (the newest ones). */
const MAX_SEEN = 1000;

export function isNotificationOn(source: string, kind: string): boolean {
  const s = useUI.getState().settings;
  return s.notificationsEnabled && !s.notificationsMuted.includes(`${source}:${kind}`);
}

export async function setNotificationOn(source: string, kind: string, on: boolean) {
  const { settings, updateSetting } = useUI.getState();
  const key = `${source}:${kind}`;
  await updateSetting("notificationsMuted", on ? settings.notificationsMuted.filter((k) => k !== key) : [...new Set([...settings.notificationsMuted, key])]);
}

let lastSound = 0;

/** The chosen sound, at most once every few seconds (a burst of notifications, from one check or several, makes one sound). */
async function sound() {
  const name = useUI.getState().settings.notificationSound;
  if (name === "none" || Date.now() - lastSound < 3000) return;
  lastSound = Date.now();
  await notifications().playSound(name).catch((e) => console.warn("Notification sound failed", e));
}

/**
 * Shows it on the desktop. macOS only puts it in Notification Center while
 * Forgor is the app in front, so then it's also shown inside the app.
 */
async function show(n: DesktopNotification): Promise<boolean> {
  const ok = await notifications().send(n);
  if (ok && notifications().hiddenWhileInFront && document.hasFocus()) showNotice(n.title, n.body);
  return ok;
}

/** Shows one notification now (if its kind is on), and keeps it in the history. */
export async function notify(source: string, kind: string, n: DesktopNotification & { open?: NotificationTarget }): Promise<void> {
  if (!isNotificationOn(source, kind)) return;
  await record(source, kind, [n]);
  if (await show(n)) await sound();
}

/** Settings → Send a test notification: always, with the chosen sound, and in the history too. False when the system doesn't allow it. */
export async function sendTestNotification(): Promise<boolean> {
  lastSound = 0;
  const test = { title: "Forgor", body: "Notifications work." };
  await record("app", "test", [test]);
  const ok = await show(test);
  if (ok) await sound();
  return ok;
}

/**
 * Notifies about the items it hasn't seen before. The very first call for a
 * kind only remembers them (no flood of everything that's already there),
 * unless `baseline` is false (the caller already filtered on "new since").
 * Items not in `items` stay remembered, so a source may pass only part of
 * its data. More than a few at once become one summary.
 */
export async function notifyNew(
  source: string,
  kind: string,
  items: NotifyItem[],
  options: { baseline?: boolean; summary?: (n: number) => DesktopNotification } = {},
): Promise<NotifyItem[]> {
  const key = `notifications.seen.${kind}`;
  const seen = await getPluginValue<string[] | null>(source, key, null);
  const fresh = seen ? items.filter((i) => !seen.includes(i.id)) : options.baseline === false ? items : [];
  const ids = [...(seen ?? []).filter((id) => !items.some((i) => i.id === id)), ...items.map((i) => i.id)].slice(-MAX_SEEN);
  if (!seen || fresh.length) await setPluginValue(source, key, ids);
  if (!fresh.length || !isNotificationOn(source, kind)) return fresh;
  // Each one in the history, also when the desktop gets one summary.
  await record(source, kind, fresh);
  let shown = false;
  if (fresh.length > MAX_SINGLE) {
    shown = await show(options.summary?.(fresh.length) ?? { title: `${fresh.length} new`, body: fresh.slice(0, MAX_SINGLE).map((i) => i.title).join("\n") });
  } else {
    for (const i of fresh) shown = (await show({ title: i.title, body: i.body })) || shown;
  }
  if (shown) await sound();
  return fresh;
}

const checks = new Set<() => Promise<void>>();

async function run(check: () => Promise<void>) {
  try {
    await check();
  } catch (e) {
    // A check failing (offline, token expired) mustn't toast every few minutes: the pages show those errors.
    console.warn("Notification check failed", e);
  }
}

/** Runs `check` shortly after it's registered and then every `everyMs`; returns how to stop. */
export function pollForNotifications(check: () => Promise<void>, everyMs = 5 * 60_000): () => void {
  checks.add(check);
  const first = setTimeout(() => void run(check), 15_000);
  const timer = setInterval(() => void run(check), everyMs);
  return () => {
    checks.delete(check);
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Runs every registered check now (tests; a manual "check now"). */
export async function checkNotificationsNow(): Promise<void> {
  for (const c of [...checks]) await run(c);
}
