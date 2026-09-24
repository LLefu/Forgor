import { isTauri } from "./env";

/**
 * Thin wrapper around the Tauri updater. Updates are published as GitHub
 * releases (see .github/workflows/release.yml); the app reads
 * releases/latest/download/latest.json and verifies the signature with the
 * public key in tauri.conf.json.
 */

export interface AvailableUpdate {
  version: string;
  notes: string;
  date: string | null;
  /** Downloads, verifies and installs; reports progress 0..1 (null when size unknown). */
  install: (onProgress: (fraction: number | null) => void) => Promise<void>;
}

export async function currentVersion(): Promise<string> {
  if (!isTauri()) return "dev";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Returns the newer version if there is one, null when up to date. Throws on network errors. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 15_000 });
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    date: update.date ?? null,
    install: async (onProgress) => {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          onProgress(total ? Math.min(1, received / total) : null);
        }
        if (event.event === "Finished") onProgress(1);
      });
    },
  };
}

export async function restartApp() {
  if (!isTauri()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
