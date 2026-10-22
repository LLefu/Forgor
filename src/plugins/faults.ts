/**
 * When a community plugin causes trouble it is switched off at once and
 * labelled (registry.tsx `handleFault`). These are the pure parts: which plugin
 * an error came from, and when repeated unhandled rejections are too many.
 */

/** What is remembered about a plugin that was switched off (settings.pluginFaults). */
export interface PluginFault {
  /** What went wrong, in a line. */
  message: string;
  /** Where it was caught: "its page", "an uncaught error"… */
  where: string;
  /** ISO time. */
  at: string;
}

/**
 * The plugin an error came from: community plugins are loaded with a source
 * name (`//# sourceURL=forgor-plugin://<id>/main.js`), which is in the stack of
 * anything thrown from their code (Chromium and WebKit alike). The innermost
 * plugin frame wins. null: the error isn't from plugin code.
 */
export function pluginIdFromStack(stack: unknown): string | null {
  if (typeof stack !== "string") return null;
  const m = /forgor-plugin:\/\/([a-z0-9][a-z0-9-]*)\/main\.js/.exec(stack);
  return m ? m[1] : null;
}

export const errorMessage = (error: unknown): string => {
  const raw = String((error as Error | undefined)?.message ?? error ?? "Unknown error").replace(/\s+/g, " ").trim();
  return raw.length > 200 ? `${raw.slice(0, 199)}…` : raw || "Unknown error";
};

/**
 * Unhandled promise rejections are often a plugin's own failed request (offline…):
 * one is a notice, not a reason to switch it off. This many within the window is.
 */
export const REJECTION_LIMIT = 5;
export const REJECTION_WINDOW_MS = 60_000;

const rejections = new Map<string, number[]>();

/** Records a rejection of this plugin; true when it has now had too many. */
export function tooManyRejections(id: string, now = Date.now()): boolean {
  const recent = [...(rejections.get(id) ?? []).filter((t) => now - t < REJECTION_WINDOW_MS), now];
  rejections.set(id, recent);
  return recent.length >= REJECTION_LIMIT;
}

export const resetRejections = () => rejections.clear();
