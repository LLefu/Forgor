import { showError } from "@/components/Toasts";
import { errorMessage, pluginIdFromStack, tooManyRejections } from "./faults";
import { reportPluginFault } from "./host";
import { getPlugin } from "./registry";

/**
 * Errors nobody catches: a click handler or timer of a plugin that throws, a
 * promise it never handles. The stack says which plugin it was
 * (faults.ts `pluginIdFromStack`). An uncaught error switches the plugin off
 * at once; a rejected promise is often just a failed request (offline), so it
 * is shown first and only repeated ones switch it off. Mount once per window.
 */
export function installPluginErrorListeners(): () => void {
  const onError = (e: ErrorEvent) => {
    const id = pluginIdFromStack((e.error as Error | undefined)?.stack);
    if (id) reportPluginFault(id, e.error ?? e.message, "an uncaught error");
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const id = pluginIdFromStack((e.reason as Error | undefined)?.stack);
    if (!id) return; // not from plugin code: the toast host shows it
    const name = getPlugin(id)?.name ?? id;
    if (tooManyRejections(id)) reportPluginFault(id, e.reason, "failing again and again");
    else showError(errorMessage(e.reason), `Plugin “${name}”`);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
