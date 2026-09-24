import { isTauri } from "./tauri";
import { ctx } from "@/data/context";

/** Reveal a vault item in Windows Explorer / macOS Finder (desktop only). */
export async function revealInOs(vaultPath: string) {
  if (!isTauri()) {
    alert(`In the desktop app this opens:\n${vaultPath}`);
    return;
  }
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  const root = ctx().vault.rootLabel;
  const sep = root.includes("\\") ? "\\" : "/";
  await revealItemInDir(vaultPath ? root + sep + vaultPath.split("/").join(sep) : root);
}

/** Open an external URL (http/mailto) in the default browser. */
export async function openExternal(url: string) {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
