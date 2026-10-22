/**
 * Did Forgor start properly last time? Each start of the main window counts
 * as unhealthy until it has run for HEALTHY_AFTER_MS (or is closed normally).
 * A plugin that freezes Forgor can't be caught from inside, but the next start
 * can tell: after SAFE_MODE_AFTER unhealthy starts in a row, community
 * plugins are switched off (community.tsx) so Forgor opens again.
 */
const KEY = "forgor.unhealthyStarts";
export const SAFE_MODE_AFTER = 2;
export const HEALTHY_AFTER_MS = 10_000;

/** Pure: the count to store for this start, and whether to start in safe mode. */
export function decideStart(previousUnhealthy: number): { count: number; safeMode: boolean } {
  return { count: previousUnhealthy + 1, safeMode: previousUnhealthy >= SAFE_MODE_AFTER };
}

const read = () => {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const write = (n: number) => {
  try {
    if (n > 0) localStorage.setItem(KEY, String(n));
    else localStorage.removeItem(KEY);
  } catch {
    // unavailable: no safe mode, nothing else
  }
};

let started: boolean | null = null;
let keepCount = false;

/** Call once when the main window starts; true: start in safe mode (the last starts weren't healthy). */
export function beginStartup(): boolean {
  if (started !== null) return started; // StrictMode runs effects twice
  const { count, safeMode } = decideStart(read());
  write(count);
  started = safeMode;
  const healthy = () => {
    if (!keepCount) write(0); // not when the crash screen asked for a safe-mode start
  };
  setTimeout(healthy, HEALTHY_AFTER_MS);
  window.addEventListener("pagehide", healthy, { once: true });
  return safeMode;
}

/** "Start without community plugins" on the crash screen: the next start is a safe-mode start. */
export function requestSafeMode() {
  keepCount = true;
  write(SAFE_MODE_AFTER);
}
