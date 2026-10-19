import { confirmDialog } from "@/components/ConfirmDialog";
import { showError } from "@/components/Toasts";
import { dependentsOf, getPlugin, setPluginEnabled } from "@/plugins/registry";

/** Enable or disable a plugin from the UI: asks first when others depend on it, shows why it can't. */
export async function togglePlugin(id: string, on: boolean) {
  if (!on) {
    const dependents = dependentsOf(id);
    if (dependents.length) {
      const ok = await confirmDialog({
        title: `Disable ${getPlugin(id)?.name}?`,
        message: `${dependents.map((p) => p.name).join(", ")} ${dependents.length === 1 ? "needs" : "need"} it and will be disabled too. Their data is kept.`,
        confirmLabel: "Disable",
      });
      if (!ok) return;
    }
  }
  await setPluginEnabled(id, on).catch((e) => showError(e, "Plugins"));
}
