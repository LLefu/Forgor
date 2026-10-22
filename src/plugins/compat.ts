import { version as APP_VERSION } from "../../package.json";

/** a > b for "x.y.z" versions. */
export function newerVersion(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/**
 * The plugin was made for a newer Forgor than this one (its `minAppVersion`).
 * Not a reason to refuse it: it is shown as a warning, and a plugin that then
 * misbehaves is switched off like any other.
 */
export const needsNewerApp = (minAppVersion?: string | null) => !!minAppVersion && newerVersion(minAppVersion, APP_VERSION);

export const appVersion = APP_VERSION;

/** "Made for Forgor 1.2.0 (this is 1.1.0): it may not work properly." */
export const newerAppWarning = (minAppVersion: string) => `Made for Forgor ${minAppVersion}, this is ${APP_VERSION}. It may not work properly.`;
