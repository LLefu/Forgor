/**
 * Subscribing to native (Tauri) events. Use this instead of `listen` from
 * @tauri-apps/api/event: Tauri resolves `listen` before the webview has
 * recorded the listener (it does that in a script it runs a moment later), so
 * unsubscribing right away, as a React effect does when it runs twice in dev
 * or when a plugin is switched on and off, threw and left the listener
 * active. The function returned here can be called at any time, also before
 * subscribing has finished.
 */
export function onTauriEvent<T>(event: string, cb: (payload: T) => void): () => void {
  let stopped = false;
  let unlisten: (() => void | Promise<void>) | null = null;
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<T>(event, (e) => !stopped && cb(e.payload)))
    .then((un) => {
      unlisten = un;
      if (stopped) void unlistenWhenRecorded(un);
    });
  return () => {
    if (stopped) return;
    stopped = true;
    if (unlisten) void unlistenWhenRecorded(unlisten);
  };
}

/** Retries while the webview hasn't recorded the listener yet (that is what throws). */
async function unlistenWhenRecorded(unlisten: () => void | Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await unlisten();
    } catch (e) {
      if (attempt >= 20) return console.warn("Could not stop listening to a native event", e);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}
