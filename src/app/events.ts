/**
 * App events plugins can follow (see `api.app.on` in plugins/api.ts). Kept
 * free of imports so the store can emit them without import cycles.
 */
export interface AppEvents {
  /** A folder was opened (explorer, breadcrumb, link…): its id. */
  "folder-open": string;
}

type Listener<K extends keyof AppEvents> = (payload: AppEvents[K]) => void;
const listeners = new Map<keyof AppEvents, Set<(payload: never) => void>>();

export function onAppEvent<K extends keyof AppEvents>(event: K, cb: Listener<K>): () => void {
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(cb);
  return () => void set.delete(cb);
}

export function emitAppEvent<K extends keyof AppEvents>(event: K, payload: AppEvents[K]) {
  (listeners.get(event) as Set<Listener<K>> | undefined)?.forEach((cb) => {
    try {
      cb(payload);
    } catch (e) {
      console.error(`A listener for "${event}" failed`, e);
    }
  });
}
