import { create } from "zustand";
import { checkForUpdate, currentVersion, restartApp, type AvailableUpdate } from "@/platform/updates";
import { isTauri } from "@/platform/env";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; checkedAt: Date }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; update: AvailableUpdate; progress: number | null }
  | { kind: "ready"; update: AvailableUpdate }
  | { kind: "error"; message: string };

interface UpdateState {
  version: string;
  status: Status;
  /** `silent` checks (startup/periodic) don't show errors, since being offline is normal. */
  check: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

export const useUpdates = create<UpdateState>((set, get) => ({
  version: "",
  status: { kind: "idle" },

  check: async ({ silent = false } = {}) => {
    const s = get().status.kind;
    if (s === "checking" || s === "installing" || s === "ready") return;
    if (!silent) set({ status: { kind: "checking" } });
    try {
      const update = await checkForUpdate();
      set({ status: update ? { kind: "available", update } : { kind: "up-to-date", checkedAt: new Date() } });
    } catch (e) {
      if (silent) set((st) => (st.status.kind === "checking" ? { status: { kind: "idle" } } : st));
      else set({ status: { kind: "error", message: friendlyError(e) } });
    }
  },

  install: async () => {
    const st = get().status;
    if (st.kind !== "available") return;
    const update = st.update;
    set({ status: { kind: "installing", update, progress: 0 } });
    try {
      await update.install((progress) => set({ status: { kind: "installing", update, progress } }));
      // On Windows the installer closes the app itself; on macOS we restart.
      set({ status: { kind: "ready", update } });
    } catch (e) {
      set({ status: { kind: "error", message: friendlyError(e) } });
    }
  },

  restart: () => restartApp(),
}));

function friendlyError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/network|dns|connect|timed? ?out|offline|request/i.test(msg)) return "Couldn't reach GitHub. Check your internet connection and try again.";
  if (/signature/i.test(msg)) return "The downloaded update failed its signature check and was not installed.";
  return msg;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Call once from the main window: reads the version and checks in the background. */
export function startUpdateChecks() {
  if (!isTauri()) return () => {};
  void currentVersion().then((version) => useUpdates.setState({ version }));
  const first = setTimeout(() => void useUpdates.getState().check({ silent: true }), 5_000);
  const timer = setInterval(() => void useUpdates.getState().check({ silent: true }), SIX_HOURS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
